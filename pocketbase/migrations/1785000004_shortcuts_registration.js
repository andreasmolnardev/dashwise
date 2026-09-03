/// <reference path="../pb_data/types.d.ts" />

const shortcutsAppsId = "pbc_342shortcutapp";
const shortcutsId = "pbc_3591471183";
const legacyAppFieldId = "text3379458255";
const appRelationFieldId = "relation342shortcutapp";

migrate((app) => {
  const shortcutsApps = new Collection({
    "createRule": "@request.auth.id = user",
    "deleteRule": "@request.auth.id = user",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "_pb_users_auth_",
        "hidden": false,
        "id": "relation342shortcutuser",
        "maxSelect": 1,
        "minSelect": 1,
        "name": "user",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text342shortcutsource",
        "max": 0,
        "min": 1,
        "name": "sourceId",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text342shortcutname",
        "max": 255,
        "min": 1,
        "name": "name",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select342shortcuttype",
        "maxSelect": 1,
        "name": "type",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": ["just-in-time", "on-demand"]
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text342shortcuticon",
        "max": 0,
        "min": 0,
        "name": "icon",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": shortcutsAppsId,
    "indexes": [
      "CREATE UNIQUE INDEX `idx_shortcutsApps_user_sourceId` ON `shortcutsApps` (`user`, `sourceId`)"
    ],
    "listRule": "@request.auth.id = user",
    "name": "shortcutsApps",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id = user",
    "viewRule": "@request.auth.id = user"
  });

  app.save(shortcutsApps);

  const shortcuts = app.findCollectionByNameOrId(shortcutsId);
  shortcuts.name = "shortcuts";

  const legacyAppField = shortcuts.fields.getByName("app");
  legacyAppField.name = "legacyApp";
  app.save(shortcuts);

  shortcuts.fields.addAt(shortcuts.fields.length, new Field({
    "cascadeDelete": false,
    "collectionId": shortcutsAppsId,
    "hidden": false,
    "id": appRelationFieldId,
    "maxSelect": 1,
    "minSelect": 0,
    "name": "app",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }));
  app.save(shortcuts);

  const records = app.findRecordsByFilter("shortcuts", "legacyApp != \"\"", "created", 100000, 0);
  const appsByKey = {};
  for (const record of records) {
    const userId = String(record.get("user") || "").trim();
    const sourceId = String(record.get("legacyApp") || "").trim();
    if (!userId || !sourceId) {
      record.set("app", null);
      app.save(record);
      continue;
    }

    const key = userId + "\u0000" + sourceId;
    let shortcutApp = appsByKey[key];
    if (!shortcutApp) {
      const existing = app.findRecordsByFilter(
        "shortcutsApps",
        "user = \"" + escapeFilter(userId) + "\" && sourceId = \"" + escapeFilter(sourceId) + "\"",
        "created",
        1,
        0,
      );
      shortcutApp = existing.length > 0 ? existing[0] : null;
    }

    if (!shortcutApp) {
      const appName = resolveAppName(app, sourceId);
      shortcutApp = new Record(shortcutsApps);
      shortcutApp.set("user", userId);
      shortcutApp.set("sourceId", sourceId);
      shortcutApp.set("name", appName.name);
      shortcutApp.set("type", "just-in-time");
      shortcutApp.set("icon", appName.icon);
      app.save(shortcutApp);
    }

    appsByKey[key] = shortcutApp;
    record.set("app", shortcutApp.id);
    app.save(record);
  }

  // Existing integration group entries point at the legacy text identifier
  // in their app:<id> action. Point those group entries at the new relation
  // record as well so grouping works immediately after the migration.
  const allShortcuts = app.findRecordsByFilter("shortcuts", "", "created", 100000, 0);
  for (const record of allShortcuts) {
    const action = String(record.get("action") || "");
    const userId = String(record.get("user") || "").trim();
    if (!action.startsWith("app:") || !userId) continue;

    const shortcutApp = appsByKey[userId + "\u0000" + action.slice(4).trim()];
    if (!shortcutApp) continue;
    record.set("action", "app:" + shortcutApp.id);
    app.save(record);
  }

  shortcuts.fields.removeById(legacyAppFieldId);
  return app.save(shortcuts);
}, (app) => {
  const shortcuts = app.findCollectionByNameOrId(shortcutsId);
  const shortcutsApps = app.findCollectionByNameOrId(shortcutsAppsId);
  const records = app.findRecordsByFilter("shortcuts", "", "created", 100000, 0);

  for (const record of records) {
    const appId = String(record.get("app") || "").trim();
    const action = String(record.get("action") || "");
    if (!appId) {
      if (action.startsWith("app:")) {
        try {
          const shortcutApp = app.findRecordById(shortcutsAppsId, action.slice(4).trim());
          record.set("action", "app:" + String(shortcutApp.get("sourceId") || ""));
        } catch (_) {
          // Leave unrelated app actions unchanged.
        }
      }
      record.set("legacyApp", "");
      app.save(record);
      continue;
    }

    try {
      const shortcutApp = app.findRecordById(shortcutsAppsId, appId);
      record.set("legacyApp", String(shortcutApp.get("sourceId") || ""));
    } catch (_) {
      record.set("legacyApp", "");
    }
    app.save(record);
  }

  shortcuts.fields.removeById(appRelationFieldId);
  shortcuts.fields.addAt(shortcuts.fields.length, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": legacyAppFieldId,
    "max": 0,
    "min": 0,
    "name": "app",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }));
  shortcuts.name = "searchItems";
  app.save(shortcuts);
  return app.delete(shortcutsApps);
});

function escapeFilter(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveAppName(app, sourceId) {
  if (sourceId.startsWith("integration:")) {
    const integrationId = sourceId.slice("integration:".length).trim();
    try {
      const integration = app.findRecordById("integrations", integrationId);
      const config = parseObject(integration.get("config"));
      const name = firstString(
        integration.get("name"),
        config.details && config.details.name,
        integration.get("source"),
      );
      const icon = firstString(config.details && config.details.icon);
      if (name) return { name, icon };
    } catch (_) {
      // Use the source identifier when its integration was removed already.
    }
  }

  return { name: sourceId, icon: "" };
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
