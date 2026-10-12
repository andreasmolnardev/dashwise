import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migration = readFileSync(
  new URL("../pocketbase/migrations/1785000012_sdk_integration_runtime.js", import.meta.url),
  "utf8",
);
const schemaRepairMigration = readFileSync(
  new URL("../pocketbase/migrations/1785000014_persist_sdk_integration_schema.js", import.meta.url),
  "utf8",
);

describe("SDK integration runtime migration", () => {
  test("persists the SDK integration schema before creating runtime collections", () => {
    expect(migration).toContain('typeField.type() === "select"');
    expect(migration).toContain('values: [...typeField.values, "sdk"]');
    expect(migration).toContain("integrations.fields.add(new SelectField({");
    expect(migration).toContain('name: "sdkConfig"');
    expect(migration.indexOf("app.save(integrations)")).toBeLessThan(
      migration.indexOf("app.save(resources)"),
    );
  });

  test("repairs databases where the original SDK runtime migration was already applied", () => {
    expect(schemaRepairMigration).toContain('typeField.type() === "select"');
    expect(schemaRepairMigration).toContain('values: [...typeField.values, "sdk"]');
    expect(schemaRepairMigration).toContain("integrations.fields.add(new SelectField({");
    expect(schemaRepairMigration).toContain('name: "sdkConfig"');
    expect(schemaRepairMigration).toContain("return app.save(integrations)");
  });
});
