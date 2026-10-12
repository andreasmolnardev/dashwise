import { describe, expect, test } from "bun:test";
import { getSdkShortcutResourceIdentities } from "./sdkShortcutResources";

describe("SDK resources in Search shortcuts", () => {
  test("subscribes to unique well-formed SDK resource actions only", () => {
    expect(getSdkShortcutResourceIdentities([
      { action: { type: "sdk-resource", instanceId: "ha-1", collectionId: "entities", resourceId: "light.study" } },
      { action: { type: "sdk-resource", instanceId: "ha-1", collectionId: "entities", resourceId: "light.study" } },
      { action: { type: "sdk-resource", instanceId: "ha-1", collectionId: "entities" } },
      { action: { type: "post", instanceId: "ha-1", collectionId: "entities", resourceId: "light.study" } },
      { action: "https://example.test" },
    ])).toEqual([
      { instanceId: "ha-1", collectionId: "entities", resourceId: "light.study" },
    ]);
  });
});
