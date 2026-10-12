/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const integrations = app.findCollectionByNameOrId("integrations");
  const typeField = integrations.fields.getByName("type");
  if (typeField && typeField.type === "select" && !typeField.values.includes("sdk")) {
    typeField.values = [...typeField.values, "sdk"];
  }
  if (!integrations.fields.getByName("sdkConfig")) {
    integrations.fields.add(new Field({
      hidden: true,
      id: "textSdkConfig001",
      max: 0,
      min: 0,
      name: "sdkConfig",
      presentable: false,
      required: false,
      system: false,
      type: "text",
    }));
  }

  const resources = new Collection({
    createRule: null,
    deleteRule: null,
    fields: [
      { autogeneratePattern: "[a-z0-9]{15}", hidden: false, id: "textSdkResId001", max: 15, min: 15, name: "id", pattern: "^[a-z0-9]+$", presentable: false, primaryKey: true, required: true, system: true, type: "text" },
      { cascadeDelete: true, collectionId: "_pb_users_auth_", hidden: true, id: "relationSdkResOwner1", maxSelect: 1, minSelect: 1, name: "owner", presentable: false, required: true, system: false, type: "relation" },
      { cascadeDelete: true, collectionId: "pbc_733358252", hidden: true, id: "relationSdkResInst1", maxSelect: 1, minSelect: 1, name: "instance", presentable: false, required: true, system: false, type: "relation" },
      { hidden: false, id: "textSdkResColl01", max: 120, min: 1, name: "resourceCollection", presentable: false, required: true, system: false, type: "text" },
      { hidden: false, id: "textSdkResKey001", max: 200, min: 1, name: "resourceId", presentable: false, required: true, system: false, type: "text" },
      { hidden: false, id: "jsonSdkResApps01", maxSize: 20000, name: "appIds", presentable: false, required: false, system: false, type: "json" },
      { hidden: false, id: "jsonSdkResData01", maxSize: 200000, name: "data", presentable: false, required: true, system: false, type: "json" },
      { hidden: false, id: "numberSdkResRev01", min: 0, name: "revision", presentable: false, required: true, system: false, type: "number" },
      { hidden: false, id: "boolSdkResStale01", name: "stale", presentable: false, required: false, system: false, type: "bool" },
      { hidden: false, id: "textSdkResUpstr1", max: 512, min: 0, name: "upstreamId", presentable: false, required: false, system: false, type: "text" },
      { hidden: false, id: "autodateSdkRes01", name: "updatedAt", onCreate: true, onUpdate: true, presentable: false, system: false, type: "autodate" },
    ],
    id: "pbc_sdkrscs001",
    indexes: ["CREATE UNIQUE INDEX idx_sdk_resources_identity ON sdkIntegrationResources (instance, resourceCollection, resourceId)"],
    listRule: null,
    name: "sdkIntegrationResources",
    system: false,
    type: "base",
    updateRule: null,
    viewRule: null,
  });

  const storage = new Collection({
    createRule: null,
    deleteRule: null,
    fields: [
      { autogeneratePattern: "[a-z0-9]{15}", hidden: false, id: "textSdkStoId001", max: 15, min: 15, name: "id", pattern: "^[a-z0-9]+$", presentable: false, primaryKey: true, required: true, system: true, type: "text" },
      { cascadeDelete: true, collectionId: "_pb_users_auth_", hidden: true, id: "relationSdkStoOwner1", maxSelect: 1, minSelect: 1, name: "owner", presentable: false, required: true, system: false, type: "relation" },
      { cascadeDelete: true, collectionId: "pbc_733358252", hidden: true, id: "relationSdkStoInst01", maxSelect: 1, minSelect: 1, name: "instance", presentable: false, required: true, system: false, type: "relation" },
      { hidden: false, id: "textSdkStoKey001", max: 200, min: 1, name: "key", presentable: false, required: true, system: false, type: "text" },
      { hidden: false, id: "jsonSdkStoVal001", maxSize: 200000, name: "value", presentable: false, required: true, system: false, type: "json" },
      { hidden: false, id: "autodateSdkSto01", name: "updatedAt", onCreate: true, onUpdate: true, presentable: false, system: false, type: "autodate" },
    ],
    id: "pbc_sdkstor001",
    indexes: ["CREATE UNIQUE INDEX idx_sdk_storage_identity ON sdkIntegrationStorage (instance, key)"],
    listRule: null,
    name: "sdkIntegrationStorage",
    system: false,
    type: "base",
    updateRule: null,
    viewRule: null,
  });

  app.save(resources);
  return app.save(storage);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("sdkIntegrationStorage"));
  app.delete(app.findCollectionByNameOrId("sdkIntegrationResources"));
  const integrations = app.findCollectionByNameOrId("integrations");
  integrations.fields.removeByName("sdkConfig");
  const typeField = integrations.fields.getByName("type");
  if (typeField && typeField.type === "select") {
    typeField.values = typeField.values.filter((value) => value !== "sdk");
  }
  return app.save(integrations);
});
