import { describe, expect, test } from "bun:test";

const migrationsDirectory = `${import.meta.dir}/../../../../../pocketbase/migrations`;

async function readMigration(name: string) {
  return Bun.file(`${migrationsDirectory}/${name}`).text();
}

describe("PocketBase collection permission migrations", () => {
  test("link collections require an authenticated owner", async () => {
    const migration = await readMigration("1785000006_secure_link_collection_rules.js");

    expect(migration).not.toContain('"createRule": ""');
    expect(migration).not.toContain('"listRule": ""');
    expect(migration).toContain("@request.body.user = @request.auth.id");
    expect(migration).toContain("@request.body.list.user = @request.auth.id");
    expect(migration).toContain("@request.body.collection.user = @request.auth.id");
    expect(migration).toContain("list.user = @request.auth.id");
    expect(migration).toContain("collection.user = @request.auth.id");
    expect(migration).toContain("@request.body.user:changed = false");
  });

  test("notifications are owner-readable and backend-writable only", async () => {
    const migration = await readMigration("1785000007_secure_notification_collection_rules.js");

    expect(migration).not.toContain('"listRule": ""');
    expect(migration).toContain("topicId.userId = @request.auth.id");
    expect(migration).toContain("userId = @request.auth.id");
    expect(migration.match(/"createRule": null/g)).toHaveLength(4);
    expect(migration.match(/"updateRule": null/g)).toHaveLength(4);
    expect(migration.match(/"deleteRule": null/g)).toHaveLength(4);
  });
});
