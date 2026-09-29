import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { ApiActionError } from "./data/auth";
import { ensureSession } from "./data/sessions";
import { config } from "./config";

type DeviceSocket = { send: (data: string) => void; close?: (code?: number, reason?: string) => void };

type PendingDeviceCode = {
  id: string;
  userId: string | null;
  code: string;
  secret: string;
  createdAt: string;
  expiresAt: number;
  ip: string;
  userAgent: string;
  socket: DeviceSocket;
  consumed: boolean;
  socketAuthenticated: boolean;
};

const pending = new Map<string, PendingDeviceCode>();
const rate = new Map<string, number[]>();
const auditEvents: Array<Record<string, unknown>> = [];
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function purge() {
  const now = Date.now();
  for (const [id, request] of pending) {
    if (request.expiresAt <= now || request.consumed) pending.delete(id);
  }
  for (const [key, timestamps] of rate) {
    const current = timestamps.filter((time) => time > now - 60_000);
    if (current.length) rate.set(key, current); else rate.delete(key);
  }
}

function limited(key: string, maximum: number) {
  purge();
  const timestamps = rate.get(key) ?? [];
  if (timestamps.length >= maximum) return true;
  timestamps.push(Date.now());
  rate.set(key, timestamps);
  return false;
}

function randomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += codeAlphabet[randomBytes(1)[0] % codeAlphabet.length];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createDeviceRequest(socket: DeviceSocket, ip: string, userAgent: string) {
  purge();
  const activeSockets = [...pending.values()].filter((request) => !request.consumed).length;
  if (pending.size >= config.AUTH_DEVICE_CODE_MAX_PENDING ||
      activeSockets >= config.AUTH_DEVICE_CODE_MAX_SOCKETS) {
    throw new ApiActionError("Device login is temporarily unavailable", 429, { error: "Device login is temporarily unavailable" });
  }
  if (limited(`create:${ip}`, 10)) {
    throw new ApiActionError("Too many device login requests", 429, { error: "Too many device login requests" });
  }
  let code = randomCode();
  while (pending.has(code)) code = randomCode();
  const request: PendingDeviceCode = {
    id: randomUUID(), userId: null, code, secret: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(), expiresAt: Date.now() + config.AUTH_DEVICE_CODE_TTL_MS,
    ip: ip || "unknown", userAgent: userAgent.slice(0, 300), socket, consumed: false, socketAuthenticated: false,
  };
  pending.set(request.id, request);
  return { id: request.id, code: request.code, secret: request.secret, expiresAt: new Date(request.expiresAt).toISOString() };
}

function invalidCode() {
  return new ApiActionError("Invalid or expired device code", 400, { error: "Invalid or expired device code" });
}

export function findDeviceRequest(rawCode: unknown, ip: string) {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code) || limited(`entry:${ip}`, 20)) throw invalidCode();
  purge();
  const request = [...pending.values()].find((item) => item.code === code && !item.consumed);
  if (!request || request.expiresAt <= Date.now()) throw invalidCode();
  return { id: request.id, code: request.code, createdAt: request.createdAt, expiresAt: new Date(request.expiresAt).toISOString(), ip: request.ip, userAgent: request.userAgent };
}

export async function approveDeviceRequest(rawCode: unknown, approver: { pb: any; userId: string; sessionId: string | null }, ip: string) {
  const viewed = findDeviceRequest(rawCode, ip);
  const request = pending.get(viewed.id);
  if (!request || request.consumed || !request.socketAuthenticated) throw invalidCode();
  if (request.userId && request.userId !== approver.userId) throw invalidCode();
  request.userId = approver.userId;
  request.consumed = true;
  const authModel = await approver.pb.collection("users").authRefresh();
  const token = authModel.token;
  const sessionId = randomUUID().replace(/-/g, "");
  await ensureSession(approver.pb, approver.userId, sessionId, { clientType: "device-code", platform: request.userAgent });
  request.socket.send(JSON.stringify({ type: "approved", token, user: authModel.record, sessionId }));
  auditEvents.push({ type: "device_login_approved", userId: approver.userId, approvingSessionId: approver.sessionId, createdSessionId: sessionId, createdAt: new Date().toISOString() });
  request.socket.close?.(1000, "Approved");
  return { success: true };
}

export function cancelDeviceRequest(rawCode: unknown, ip: string) {
  const viewed = findDeviceRequest(rawCode, ip);
  const request = pending.get(viewed.id);
  if (request) { request.consumed = true; request.socket.send(JSON.stringify({ type: "cancelled" })); request.socket.close?.(1000, "Cancelled"); }
  return { success: true };
}

export function authenticateDeviceSocket(id: string, secret: string) {
  const request = pending.get(id);
  if (!request || request.consumed || request.expiresAt <= Date.now() || !sameSecret(request.secret, secret)) return false;
  request.socketAuthenticated = true;
  return true;
}

export function getDeviceAuditEvents() { return auditEvents.slice(-100); }
export function closeDeviceRequest(id: string) { const request = pending.get(id); if (request) { request.consumed = true; pending.delete(id); } }
