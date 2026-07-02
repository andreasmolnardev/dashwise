/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3219010000")

  try {
    collection.fields.removeByName("credentialEncrypted")
  } catch (_) {
    // Field does not exist yet.
  }

  collection.fields.addAt(7, new Field({
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
  }))

  let authTypeField = null
  try {
    authTypeField = collection.fields.getByName("authType")
  } catch (_) {
    authTypeField = null
  }

  if (authTypeField) {
    authTypeField.values = ["password", "key", "agent"]
  } else {
    try {
      collection.fields.removeByName("authMethod")
    } catch (_) {
      // No legacy authMethod field.
    }

    collection.fields.addAt(6, new Field({
      "hidden": false,
      "id": "select3219010007",
      "maxSelect": 1,
      "name": "authType",
      "presentable": false,
      "required": true,
      "system": false,
      "type": "select",
      "values": ["password", "key", "agent"]
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3219010000")

  collection.fields.removeByName("credentialEncrypted")

  let authTypeField = null
  try {
    authTypeField = collection.fields.getByName("authType")
  } catch (_) {
    authTypeField = null
  }

  if (authTypeField) {
    authTypeField.values = ["agent"]
  }

  return app.save(collection)
})
