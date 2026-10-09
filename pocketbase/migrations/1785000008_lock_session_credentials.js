/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_341session");
  collection.fields.getByName("tokenHash").hidden = false;
  collection.fields.getByName("pocketbaseToken").hidden = false;
  collection.listRule = null;
  collection.viewRule = null;
  collection.createRule = null;
  collection.updateRule = null;
  collection.deleteRule = null;
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_341session");
  collection.fields.getByName("tokenHash").hidden = true;
  collection.fields.getByName("pocketbaseToken").hidden = true;
  collection.listRule = "@request.auth.id = user";
  collection.viewRule = "@request.auth.id = user";
  collection.createRule = "@request.auth.id = user";
  collection.updateRule = "@request.auth.id = user";
  collection.deleteRule = "@request.auth.id = user";
  return app.save(collection);
});
