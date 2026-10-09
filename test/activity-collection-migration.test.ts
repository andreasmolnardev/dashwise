import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migration = readFileSync(
  new URL("../pocketbase/migrations/1785000009_created_activities.js", import.meta.url),
  "utf8",
);

function fieldDefinition(name: string) {
  const field = migration.match(new RegExp(`\\{[^{}]*name: "${name}"[^{}]*\\}`, "s"));
  expect(field, `expected ${name} field in activity migration`).not.toBeNull();
  return field?.[0] ?? "";
}

describe("activities PocketBase migration", () => {
  test("creates the private activities collection and removes it on rollback", () => {
    expect(migration).toContain('name: "activities"');
    expect(migration).toContain('id: "pbc_activity001"');
    expect(migration).toContain('findCollectionByNameOrId("pbc_activity001")');
    expect(migration).toContain("return app.delete(collection)");

    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      expect(migration).toMatch(new RegExp(`${rule}: null`));
    }
  });

  test("stores contract fields with bounded input sizes", () => {
    expect(fieldDefinition("owner")).toContain('collectionId: "_pb_users_auth_"');
    expect(fieldDefinition("owner")).toContain("required: true");
    expect(fieldDefinition("source")).toContain("max: 120");
    expect(fieldDefinition("sourceId")).toContain("max: 200");
    expect(fieldDefinition("eventId")).toContain("max: 256");
    expect(fieldDefinition("idempotencyKey")).toContain("max: 256");
    expect(fieldDefinition("type")).toContain("max: 200");
    expect(fieldDefinition("title")).toContain("max: 240");
    expect(fieldDefinition("description")).toContain("max: 2000");
    expect(fieldDefinition("occurredAt")).toContain('type: "text"');
    expect(fieldDefinition("createdAt")).toContain('type: "autodate"');
    expect(fieldDefinition("metadata")).toContain("maxSize: 16384");
    expect(fieldDefinition("action")).toContain("maxSize: 2048");
    expect(fieldDefinition("severity")).toContain('"error"');
  });

  test("indexes owner chronology and idempotency per source instance", () => {
    expect(migration).toContain("(owner, occurredAt DESC)");
    expect(migration).toContain("UNIQUE INDEX idx_activities_owner_source_instance_idempotency");
    expect(migration).toContain("(owner, source, sourceId, idempotencyKey)");
    expect(migration).toContain("WHERE idempotencyKey != ''");
  });
});
