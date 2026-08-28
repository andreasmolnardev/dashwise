"use client";

import { useEffect, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import {
  backendUrl,
  getMonitoringHostHistoryAction,
  type MonitoringHostStatsRecord,
} from "@/lib/apiClient";
import { getClientSessionId } from "@/lib/session";

export type HostMetricRecord = MonitoringHostStatsRecord & {
  time: string;
  values: Record<string, unknown>;
};

function normalizeRecord(record: MonitoringHostStatsRecord): HostMetricRecord | null {
  const stats = record.stats && typeof record.stats === "object" ? record.stats : record;
  const current = stats.current && typeof stats.current === "object"
    ? stats.current as Record<string, unknown>
    : stats as Record<string, unknown>;
  // History responses may wrap an agent sample in a `values` field, while
  // live frames contain the sample directly. Normalize both to metric keys.
  const values = current.values && typeof current.values === "object" && !Array.isArray(current.values)
    ? current.values as Record<string, unknown>
    : current;
  const time = String(
    record.timestamp || record.created || stats.receivedAt || current.timestamp || current.created || values.timestamp || "",
  );
  if (!time || Number.isNaN(new Date(time).getTime())) return null;
  return { ...record, time, values };
}

function recordsFrom(payload: unknown): HostMetricRecord[] {
  const raw = Array.isArray(payload)
    ? payload
    : (payload as { records?: unknown[]; record?: unknown })?.records
      || [(payload as { record?: unknown })?.record ?? payload];
  return raw.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const normalized = normalizeRecord(record as MonitoringHostStatsRecord);
    return normalized ? [normalized] : [];
  });
}

function mergeRecords(
  current: HostMetricRecord[],
  incoming: HostMetricRecord[],
  replaceEqual = true,
) {
  const merged = new Map(current.map((record) => [record.time, record]));
  incoming.forEach((record) => {
    if (replaceEqual || !merged.has(record.time)) merged.set(record.time, record);
  });
  return [...merged.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function latestTime(records: HostMetricRecord[]) {
  return records.reduce<string | null>((latest, record) => (
    !latest || record.time > latest ? record.time : latest
  ), null);
}

export function useMonitoringHostMetrics(hostId?: string) {
  const { token, withAuth } = useAuth();
  const [records, setRecords] = useState<HostMetricRecord[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !hostId) {
      setRecords([]);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | undefined;
    let attempts = 0;
    let socket: WebSocket | null = null;

    const loadRange = async (timestamp?: string) => {
      try {
        const result = await withAuth((auth) => getMonitoringHostHistoryAction(auth, hostId, timestamp));
        if (disposed) return;
        const incoming = recordsFrom(result);
        // History can overlap a live sample. Keep the live value when both
        // entries have the same (minute-resolution) timestamp.
        setRecords((current) => mergeRecords(current, incoming, false));
        const latest = latestTime(incoming);
        if (latest && (!latestRef.current || latest > latestRef.current)) latestRef.current = latest;
        setError(null);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to load host metrics");
      }
    };

    const connect = () => {
      if (disposed) return;
      const url = new URL(backendUrl(`/api/v1/monitoring/hosts/${hostId}/stats/live`));
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", token);
      const sessionId = getClientSessionId();
      if (sessionId) url.searchParams.set("sessionId", sessionId);
      if (latestRef.current) url.searchParams.set("since", latestRef.current);
      socket = new WebSocket(url.toString());

      socket.onopen = () => {
        attempts = 0;
        setLive(true);
        // Timestamp asks backend for records missed while socket was disconnected.
        void loadRange(latestRef.current ?? undefined);
      };
      socket.onmessage = (event) => {
        try {
          const incoming = recordsFrom(JSON.parse(String(event.data)));
          if (!incoming.length) return;
          latestRef.current = incoming.at(-1)?.time ?? latestRef.current;
          setRecords((current) => mergeRecords(current, incoming));
          setError(null);
        } catch {
          // Ignore non-metric websocket frames.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setLive(false);
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts++));
      };
      socket.onerror = () => socket?.close();
    };

    latestRef.current = null;
    setRecords([]);
    void loadRange();
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [hostId, token, withAuth]);

  return { records, live, error };
}
