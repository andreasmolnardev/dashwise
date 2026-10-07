/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_341session");

  collection.fields.add(new Field({
    "hidden": true,
    "id": "text341tokenhash",
    "max": 64,
    "min": 64,
    "name": "tokenHash",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }));
  collection.fields.add(new Field({
    "hidden": true,
    "id": "text341pbtoken",
    "max": 4096,
    "min": 0,
    "name": "pocketbaseToken",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }));
  collection.fields.add(new Field({
    "hidden": false,
    "id": "date341expires",
    "max": "",
    "min": "",
    "name": "expiresAt",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }));
  collection.fields.add(new Field({
    "hidden": false,
    "id": "date341revoked",
    "max": "",
    "min": "",
    "name": "revokedAt",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }));
  collection.indexes = [
    ...collection.indexes,
    "CREATE UNIQUE INDEX `idx_sessions_tokenHash` ON `sessions` (`tokenHash`)"
  ];
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_341session");
  collection.fields.removeById("text341tokenhash");
  collection.fields.removeById("text341pbtoken");
  collection.fields.removeById("date341expires");
  collection.fields.removeById("date341revoked");
  collection.indexes = collection.indexes.filter((index) => !index.includes("idx_sessions_tokenHash"));
  return app.save(collection);
});
