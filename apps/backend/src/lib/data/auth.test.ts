import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../pb/pocketbase";
import { ApiActionError, changePassword, deleteAccount, requireUserAuth } from "./auth";
import { hashSessionToken, isSessionActive } from "./sessions";

import { trackSessionConnection } from "../session-connections";

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;

beforeEach(() => {
  previousConnector = getDashwiseSDKConnector();
});

afterEach(() => {
  registerDashwiseSDKConnector(previousConnector);
});

type AuthFixture = {
  refreshCalls: string[];
  session: Record<string, unknown>;
  passwordCalls: string[];
  sessionRows: Record<string, unknown>[];
  userUpdates: Record<string, unknown>[];
  failRevocation: (error: Error) => void;
  deletedUsers: string[];
  setPasswordUser: (id: string, totpSecret?: string) => void;
  setRefreshResult: (result: "success" | "unauthorized") => void;
};

function installAuthFixture(): AuthFixture {
  const refreshCalls: string[] = [];
  const passwordCalls: string[] = [];
  const deletedUsers: string[] = [];
  const userUpdates: Record<string, unknown>[] = [];
  let revocationError: Error | undefined;
  let passwordUser = { id: "verified-user-id", totpSecret: "" };
  let refreshResult: "success" | "unauthorized" = "unauthorized";
  let storedToken = "internal-pb-token";
  const session: Record<string, unknown> = {
    id: "record-id",
    sessionId: "session-id",
    user: "verified-user-id",
    pocketbaseToken: storedToken,
    lastSeenAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const sessionRows = [session, { ...session, id: "second-record", sessionId: "second-session" }, { ...session, id: "other-record", user: "other-user" }];
  const connector = {
    async getSuperuserClient() {
      return {
        collection() {
          return {
            async getFirstListItem(filter: string) {
              if (filter !== `tokenHash = "${hashSessionToken("dws_test-session-token")}"` && filter !== 'user = "verified-user-id" && sessionId = "session-id"') throw new Error("not found");
              return session;
            },
            async getFullList({ filter }: { filter: string }) {
              if (filter !== 'user = "verified-user-id"') throw Error("unexpected owner filter");
              return sessionRows.filter(row => row.user === "verified-user-id");
            },
            async update(id: string, value: Record<string, string>) {
              if (value.revokedAt && revocationError) throw revocationError;
              if (value.pocketbaseToken) storedToken = value.pocketbaseToken;
              const row = sessionRows.find(row => row.id === id)!;
              Object.assign(row, value);
              return row;
            },
          };
        },
      };
    },
    createServerClient() {
      let token = "";
      return {
        authStore: {
          get token() { return token; },
          save(nextToken: string) { token = nextToken; },
        },
        collection() {
          return {
            async authWithPassword(email: string) {
              passwordCalls.push(email);
              return { record: passwordUser };
            },
            async update(_id: string, value: Record<string, unknown>) { userUpdates.push(value); },
            async delete(id: string) { deletedUsers.push(id); },
            async authRefresh() {
              refreshCalls.push(token);
              if (refreshResult === "unauthorized") {
                throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
              }
              return { record: { id: "verified-user-id" }, token };
            },
          };
        },
      };
    },
  };

  registerDashwiseSDKConnector(connector as never);
  return {
    refreshCalls,
    session,
    passwordCalls,
    sessionRows,
    userUpdates,
    failRevocation(error) { revocationError = error; },
    deletedUsers,
    setPasswordUser(id, totpSecret = "") { passwordUser = { id, totpSecret }; },
    setRefreshResult(result) {
      refreshResult = result;
    },
  };
}

describe("requireUserAuth", () => {
  test("rejects PocketBase JWTs because only Dashwise session credentials are accepted", async () => {
    installAuthFixture();
    await expect(requireUserAuth({ token: "eyJhbGciOiJIUzI1NiJ9.payload.signature" })).rejects.toMatchObject({ status: 401 });
  });

  test("resolves user identity through an active Dashwise session", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");

    await expect(requireUserAuth({ token: "dws_test-session-token" })).resolves.toMatchObject({
      userId: "verified-user-id",
      sessionId: "session-id",
    });
    expect(fixture.refreshCalls).toEqual(["internal-pb-token"]);
  });
});


describe("device session boundaries", () => {
  for (const [field, value] of [
    ["revokedAt", new Date().toISOString()],
    ["expiresAt", new Date(Date.now() - 60_000).toISOString()],
    ["lastSeenAt", new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()],
    ["expiresAt", "invalid date"],
    ["lastSeenAt", "invalid date"],
    ["pocketbaseToken", ""],
  ]) {
    test(`rejects invalid session ${field}: ${value}`, async () => {
      const fixture = installAuthFixture();
      fixture.setRefreshResult("success");
      fixture.session[field!] = value;
      await expect(requireUserAuth({ token: "dws_test-session-token" })).rejects.toMatchObject({ status: 401 });
      expect(fixture.refreshCalls).toHaveLength(0);
    });
  }

  test("caller-supplied session ID cannot override the authenticated session identity", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    await expect(requireUserAuth({ token: "dws_test-session-token", sessionId: "other-session" })).resolves.toMatchObject({
      userId: "verified-user-id",
      sessionId: "session-id",
    });
    expect(fixture.refreshCalls).toEqual(["internal-pb-token"]);
  });

  test("rejects a PocketBase user that differs from the session owner", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    fixture.session.user = "another-user";
    await expect(requireUserAuth({ token: "dws_test-session-token" })).rejects.toMatchObject({ status: 401 });
  });
});

describe("deleteAccount", () => {
  const payload = { email: "user@example.com", password: "password" };

  test("requires a device session before password reauthentication", async () => {
    const fixture = installAuthFixture();
    await expect(deleteAccount({}, payload)).rejects.toMatchObject({ status: 401 });
    expect(fixture.passwordCalls).toHaveLength(0);
    expect(fixture.deletedUsers).toHaveLength(0);
  });

  test("rejects a revoked device session even with correct credentials", async () => {
    const fixture = installAuthFixture();
    fixture.session.revokedAt = new Date().toISOString();
    await expect(deleteAccount({ token: "dws_test-session-token" }, payload)).rejects.toMatchObject({ status: 401 });
    expect(fixture.passwordCalls).toHaveLength(0);
  });

  test("rejects credentials for a different account", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    fixture.setPasswordUser("another-user");
    await expect(deleteAccount({ token: "dws_test-session-token" }, payload)).rejects.toMatchObject({ status: 401 });
    expect(fixture.deletedUsers).toHaveLength(0);
  });

  test("still requires TOTP for an account with two-factor authentication", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    fixture.setPasswordUser("verified-user-id", "JBSWY3DPEHPK3PXP");
    await expect(deleteAccount({ token: "dws_test-session-token" }, payload)).rejects.toMatchObject({ status: 401 });
    expect(fixture.deletedUsers).toHaveLength(0);
  });

  test("rejects an invalid TOTP during deletion", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    fixture.setPasswordUser("verified-user-id", "JBSWY3DPEHPK3PXP");
    await expect(deleteAccount({ token: "dws_test-session-token" }, { ...payload, totp: "invalid" })).rejects.toMatchObject({ status: 401 });
    expect(fixture.deletedUsers).toHaveLength(0);
  });

  test("deletes only the session owner after successful reauthentication", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    await expect(deleteAccount({ token: "dws_test-session-token" }, payload)).resolves.toBeNull();
    expect(fixture.deletedUsers).toEqual(["verified-user-id"]);
  });
});


describe("password changes revoke device sessions", () => {
  const body = { email: "user@example.com", oldPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" };

  test("revokes every owned session and rejects a socket authenticated before the password change", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    const auth = await requireUserAuth({ token: "dws_test-session-token" });
    let existingClosed = false;
    trackSessionConnection({ ...auth, validate: () => isSessionActive(auth.userId, auth.sessionId), close: () => { existingClosed = true; } });
    await expect(changePassword("dws_test-session-token", body)).resolves.toMatchObject({ message: expect.any(String) });
    expect(fixture.userUpdates).toHaveLength(1);
    expect(fixture.sessionRows.filter(row => row.user === auth.userId).every(row => !!row.revokedAt)).toBe(true);
    expect(fixture.sessionRows.find(row => row.user === "other-user")!.revokedAt).toBeUndefined();
    expect(existingClosed).toBe(true);
    let lateClosed = false;
    const late = trackSessionConnection({ ...auth, validate: () => isSessionActive(auth.userId, auth.sessionId), close: () => { lateClosed = true; } });
    expect(await late.ensureValid()).toBe(false);
    expect(lateClosed).toBe(true);
    await expect(requireUserAuth({ token: "dws_test-session-token" })).rejects.toMatchObject({ status: 401 });
  });

  test("closes existing sockets and surfaces persistence failure after password update", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    const failure = Error("session persistence failed");
    fixture.failRevocation(failure);
    let closed = false;
    const connection = trackSessionConnection({ userId: "verified-user-id", sessionId: "session-id", validate: async () => true, close: () => { closed = true; } });
    await expect(changePassword("dws_test-session-token", body)).rejects.toBe(failure);
    expect(fixture.userUpdates).toHaveLength(1);
    expect(closed).toBe(true);
    expect(connection.isActive()).toBe(false);
  });
});
