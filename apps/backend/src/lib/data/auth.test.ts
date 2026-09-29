import { describe, expect, test } from "bun:test";

import { registerDashwiseSDKConnector } from "../pb/pocketbase";
import { ApiActionError, requireUserAuth } from "./auth";

function encodedToken(payload: Record<string, unknown>, signature = "signature") {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.${signature}`;
}

type AuthFixture = {
  refreshCalls: string[];
  setRefreshResult: (result: "success" | "unauthorized") => void;
};

function installAuthFixture(): AuthFixture {
  const refreshCalls: string[] = [];
  let refreshResult: "success" | "unauthorized" = "unauthorized";
  let token = "";

  const connector = {
    createServerClient() {
      return {
        authStore: {
          token,
          save(nextToken: string) {
            token = nextToken;
            this.token = nextToken;
          },
        },
        collection() {
          return {
            async authRefresh() {
              refreshCalls.push(token);
              if (refreshResult === "unauthorized") {
                throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
              }

              return {
                record: { id: "verified-user-id" },
                token,
              };
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
  test.each([
    ["unsigned", encodedToken({ sub: "attacker-chosen-user", exp: Math.floor(Date.now() / 1000) + 3600 }, "")],
    ["malformed", "not-a-jwt"],
    ["expired", encodedToken({ sub: "attacker-chosen-user", exp: Math.floor(Date.now() / 1000) - 3600 })],
    ["incorrectly signed", encodedToken({ sub: "attacker-chosen-user", exp: Math.floor(Date.now() / 1000) + 3600 }, "wrong-signature")],
  ])("rejects %s tokens instead of trusting their payload", async (_name, token) => {
    const fixture = installAuthFixture();

    await expect(requireUserAuth({ token })).rejects.toMatchObject({ status: 401 });
    expect(fixture.refreshCalls).toEqual([token]);
  });

  test("uses the verified record ID and caches only successful verification", async () => {
    const fixture = installAuthFixture();
    fixture.setRefreshResult("success");
    const token = encodedToken({ sub: "attacker-chosen-user", exp: Math.floor(Date.now() / 1000) + 3600 });

    await expect(requireUserAuth({ token })).resolves.toMatchObject({
      userId: "verified-user-id",
    });
    await expect(requireUserAuth({ token })).resolves.toMatchObject({
      userId: "verified-user-id",
      authModel: null,
    });
    expect(fixture.refreshCalls).toHaveLength(1);
  });
});
