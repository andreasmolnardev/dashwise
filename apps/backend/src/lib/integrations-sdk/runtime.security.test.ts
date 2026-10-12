import { describe, expect, test } from "bun:test";
import { redactSdkIntegrationLog } from "./runtime";

describe("SDK integration log redaction", () => {
  test("redacts configured secrets from messages, nested metadata, and metadata keys", () => {
    const accessToken = "home-assistant-private-token";
    const safe = redactSdkIntegrationLog([accessToken], `Connection failed for ${accessToken}`, {
      credential: accessToken,
      nested: [
        `received ${accessToken}`,
        { [accessToken]: "secret property name" },
      ],
    });

    expect(safe.message).toBe("Connection failed for [REDACTED]");
    expect(safe.metadata).toEqual({
      credential: "[REDACTED]",
      nested: [
        "received [REDACTED]",
        { "[REDACTED]": "secret property name" },
      ],
    });
    expect(JSON.stringify(safe)).not.toContain(accessToken);
  });

  test("leaves normal integration logs unchanged", () => {
    expect(redactSdkIntegrationLog(["private-token"], "Connected", { state: "ready" })).toEqual({
      message: "Connected",
      metadata: { state: "ready" },
    });
  });
});
