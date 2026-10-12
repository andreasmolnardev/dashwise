import { describe, expect, it } from "bun:test";
import { parseSdkContributionKey } from "./sdkContributionKey";

describe("parseSdkContributionKey", () => {
  it("parses a canonical SDK contribution key", () => {
    expect(parseSdkContributionKey("sdk#instance-1#widget#health-summary")).toEqual({
      instanceId: "instance-1",
      kind: "widget",
      contributionId: "health-summary",
    });
  });

  it("parses an SDK contribution key inside a legacy composite key", () => {
    expect(parseSdkContributionKey("instance-1#sdk#instance-1#widget#health-summary")).toEqual({
      instanceId: "instance-1",
      kind: "widget",
      contributionId: "health-summary",
    });
  });

  it("rejects unrelated integration keys", () => {
    expect(parseSdkContributionKey("instance-1#health-summary")).toBeNull();
  });
});
