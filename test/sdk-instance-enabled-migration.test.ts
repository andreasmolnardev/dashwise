import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migration = readFileSync(
  new URL("../pocketbase/migrations/1785000013_sdk_integration_enabled.js", import.meta.url),
  "utf8",
);

describe("SDK integration enabled migration", () => {
  test("adds a persisted enable flag and migrates existing SDK instances as enabled", () => {
    expect(migration).toContain('name: "sdkEnabled"');
    expect(migration).toContain('app.findRecordsByFilter("integrations", \'type = "sdk"\')');
    expect(migration).toContain('record.set("sdkEnabled", true)');
  });

  test("removes the field on rollback", () => {
    expect(migration).toContain('integrations.fields.removeByName("sdkEnabled")');
  });
});
