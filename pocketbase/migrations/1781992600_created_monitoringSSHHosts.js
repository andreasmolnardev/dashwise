/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id = userId:lower",
    "deleteRule": "@request.auth.id = userId:lower",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3219010001",
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
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3219010002",
        "max": 0,
        "min": 0,
        "name": "userId",
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
        "id": "text3219010003",
        "max": 120,
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
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3219010004",
        "max": 255,
        "min": 1,
        "name": "hostname",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "number3219010005",
        "max": 65535,
        "min": 1,
        "name": "port",
        "onlyInt": true,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3219010006",
        "max": 120,
        "min": 1,
        "name": "username",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select3219010007",
        "maxSelect": 1,
        "name": "authMethod",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": ["password", "key"]
      },
      {
        "autogeneratePattern": "",
        "hidden": true,
        "id": "text3219010011",
        "max": 0,
        "min": 0,
        "name": "credentialEncrypted",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select3219010008",
        "maxSelect": 1,
        "name": "status",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": ["unknown", "online", "offline"]
      },
      {
        "hidden": false,
        "id": "autodate3219010009",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3219010010",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_3219010000",
    "indexes": ["CREATE INDEX idx_monitoringSSHHosts_userId ON monitoringSSHHosts (userId)"],
    "listRule": "@request.auth.id = userId:lower",
    "name": "monitoringSSHHosts",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id = userId:lower",
    "viewRule": "@request.auth.id = userId:lower"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3219010000");

  return app.delete(collection);
})
