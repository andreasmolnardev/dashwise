import { afterEach, beforeEach, expect, test } from "bun:test";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";
import sessionsRoute from "./sessions.route";
import { ensureSession, hashSessionToken, isSessionActive, revokeSession } from "../lib/data/sessions";
import { trackSessionConnection } from "../lib/session-connections";

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
beforeEach(() => { previousConnector = getDashwiseSDKConnector(); });
afterEach(() => { registerDashwiseSDKConnector(previousConnector); });

function fixture() {
  const session = {
    id: "record", user: "user", sessionId: "device", displayName: "Browser",
    tokenHash: hashSessionToken("dws_test"), pocketbaseToken: "secret-pb-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), lastSeenAt: new Date().toISOString(),
    unexpectedSecret: "future-field", revokedAt: "",
  };
  let deleted = false;
  const collection = {
    async getFirstListItem() { if (deleted) throw Error("missing"); return session; },
    async getFullList() { return [session]; },
    async update(_id: string, data: Record<string, unknown>) { Object.assign(session, data); return session; },
    async delete() { deleted = true; },
  };
  registerDashwiseSDKConnector({
    async getSuperuserClient() { return { collection: () => collection }; },
    createServerClient() { return {
      authStore: { token: "", save() {} },
      collection: () => ({ async authRefresh() { return { record: { id: "user" } }; } }),
    }; },
  } as never);
  return session;
}

for (const [method, path] of [["GET", "/sessions"], ["GET", "/sessions/current"], ["PATCH", "/sessions/current"]]) {
  test(`${method} ${path} returns allowlisted metadata without credentials`, async () => {
    fixture();
    const response = await sessionsRoute.request(`/api/v1${path}`, {
      method, headers: { Authorization: "Bearer dws_test", "Content-Type": "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ displayName: "Renamed" }) } : {}),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    const record = Array.isArray(data) ? data[0] : data;
    expect(record.sessionId).toBe("device");
    expect(record).not.toHaveProperty("pocketbaseToken");
    expect(record).not.toHaveProperty("tokenHash");
    expect(record).not.toHaveProperty("unexpectedSecret");
  });
}

test("session revocation closes connections after deleting the persisted credential", async () => {
  fixture();
  let closed = false;
  const connection = trackSessionConnection({ userId: "user", sessionId: "device", validate: () => isSessionActive("user", "device"), close: () => { closed = true; } });
  await revokeSession("user", "device");
  expect(closed).toBe(true);
  expect(connection.isActive()).toBe(false);
  expect(await isSessionActive("user", "device")).toBe(false);
});

for (const [field, value] of [["expiresAt", "invalid"], ["expiresAt", new Date(0).toISOString()], ["lastSeenAt", new Date(0).toISOString()], ["revokedAt", new Date().toISOString()]]) {
  test(`ongoing socket validation rejects ${field}=${value}`, async () => {
    const session = fixture();
    Object.assign(session, { [field!]: value });
    expect(await isSessionActive("user", "device")).toBe(false);
  });
}


test("session metadata updates cannot recreate a deleted session", async () => {
  fixture();
  await revokeSession("user", "device");
  expect(await ensureSession("user", "device", { platform: "browser" })).toBeNull();
  expect(await isSessionActive("user", "device")).toBe(false);
});
