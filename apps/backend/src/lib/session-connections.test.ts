import { describe, expect, test } from "bun:test";
import { revokeSessionConnections, revokeUserConnections, trackSessionConnection } from "./session-connections";

describe("authenticated socket lifetime", () => {
  test("revocation closes every socket for only that user's session", () => {
    const closed: string[] = [];
    const socket = (userId: string, sessionId: string, name: string) => trackSessionConnection({
      userId, sessionId, validate: async () => true, close: () => closed.push(name),
    });
    const activity = socket("a", "one", "activity");
    const ssh = socket("a", "one", "ssh");
    const metrics = socket("a", "one", "metrics");
    const other = socket("b", "one", "other");
    revokeSessionConnections("a", "one");
    expect(closed).toEqual(["activity", "ssh", "metrics"]);
    expect(activity.isActive()).toBe(false);
    expect(ssh.isActive()).toBe(false);
    expect(metrics.isActive()).toBe(false);
    expect(other.isActive()).toBe(true);
    other.dispose();
  });

  test("invalid or failed validation closes and blocks further operations", async () => {
    for (const validate of [async () => false, async () => { throw Error("database unavailable"); }]) {
      let closes = 0;
      const socket = trackSessionConnection({ userId: "expiry", sessionId: "one", validate, close: () => closes++ });
      expect(await socket.ensureValid()).toBe(false);
      expect(await socket.ensureValid()).toBe(false);
      expect(closes).toBe(1);
    }
  });

  test("simultaneous connections for one session share an in-flight validation", async () => {
    let reads = 0;
    const makeConnection = () => trackSessionConnection({
      userId: "shared", sessionId: "one", validate: async () => { reads++; return true; },
      close: () => {}, intervalMs: 1000,
    });
    const first = makeConnection();
    const second = makeConnection();
    expect(await Promise.all([first.ensureValid(), second.ensureValid()])).toEqual([true, true]);
    expect(reads).toBe(1);
    expect(await second.ensureValid()).toBe(true);
    expect(reads).toBe(2);
    first.dispose();
    second.dispose();
  });

  test("idle connections use one periodic session check", async () => {
    let reads = 0;
    const makeConnection = () => trackSessionConnection({
      userId: "shared-timer", sessionId: "one", validate: async () => { reads++; return true; },
      close: () => {}, intervalMs: 15,
    });
    const first = makeConnection();
    const second = makeConnection();
    await new Promise(resolve => setTimeout(resolve, 38));
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(3);
    first.dispose();
    second.dispose();
  });

  test("a shared expired-session result revokes every connection", async () => {
    let valid = true;
    let reads = 0;
    const makeConnection = () => trackSessionConnection({
      userId: "shared-expiry", sessionId: "one",
      validate: async () => { reads++; return valid; }, close: () => {}, intervalMs: 40,
    });
    const first = makeConnection();
    const second = makeConnection();
    expect(await first.ensureValid()).toBe(true);
    valid = false;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await second.ensureValid()).toBe(false);
    expect(first.isActive()).toBe(false);
    expect(second.isActive()).toBe(false);
    expect(reads).toBe(2);
  });

  test("revocation during pending open validation cannot reactivate the socket", async () => {
    let finish!: (valid: boolean) => void;
    const socket = trackSessionConnection({
      userId: "race", sessionId: "one", validate: () => new Promise(resolve => { finish = resolve; }), close: () => {},
    });
    const pending = socket.ensureValid();
    revokeSessionConnections("race", "one");
    finish(true);
    expect(await pending).toBe(false);
    expect(socket.isActive()).toBe(false);
  });

  test("periodic checks stop an idle socket without an incoming message", async () => {
    let valid = true;
    let done!: () => void;
    const closed = new Promise<void>(resolve => { done = resolve; });
    const socket = trackSessionConnection({
      userId: "idle", sessionId: "one", validate: async () => valid,
      close: done, intervalMs: 5,
    });
    expect(await socket.ensureValid()).toBe(true);
    valid = false;
    await closed;
    expect(socket.isActive()).toBe(false);
  });

  test("account revocation closes all sessions and normal close unregisters", () => {
    let count = 0;
    const socket = (sessionId: string) => trackSessionConnection({ userId: "account", sessionId, validate: async () => true, close: () => count++ });
    socket("one"); socket("two"); const disposed = socket("three");
    disposed.dispose();
    revokeUserConnections("account");
    expect(count).toBe(2);
  });
});


test("a transport cleanup failure does not interrupt revocation of other sockets", () => {
  trackSessionConnection({ userId: "cleanup", sessionId: "one", validate: async () => true, close: () => { throw Error("transport failure"); } });
  let closed = false;
  trackSessionConnection({ userId: "cleanup", sessionId: "one", validate: async () => true, close: () => { closed = true; } });
  revokeSessionConnections("cleanup", "one");
  expect(closed).toBe(true);
});
