import { describe, expect, test } from "bun:test";

import { registerDashwiseSDKConnector } from "../pb/pocketbase";
import { ApiActionError, requireUserAuth } from "./auth";
import { hashSessionToken } from "./sessions";

type AuthFixture = {
  refreshCalls: string[];
  setRefreshResult: (result: "success" | "unauthorized") => void;
};

function installAuthFixture(): AuthFixture {
  const refreshCalls: string[] = [];
  let refreshResult: "success" | "unauthorized" = "unauthorized";
  let storedToken = "internal-pb-token";
  const session = {
    id: "record-id",
    sessionId: "session-id",
    user: "verified-user-id",
    pocketbaseToken: storedToken,
    lastSeenAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const connector = {
    async getSuperuserClient() {
      return {
        collection() {
          return {
            async getFirstListItem(filter: string) {
              if (filter !== `tokenHash = "${hashSessionToken("dws_test-session-token")}"`) throw new Error("not found");
              return session;
            },
            async update(_id: string, value: Record<string, string>) {
              storedToken = value.pocketbaseToken;
              return session;
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
