/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3219010000")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_monitoringSSHHosts_userId` ON `monitoringHosts` (`userId`)"
    ],
    "name": "monitoringHosts"
  }, collection)

  // add field
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "select2363381545",
    "maxSelect": 0,
    "name": "type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "ssh",
      "monitor"
    ]
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "json3949473096",
    "maxSize": 0,
    "name": "systemInfo",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3219010000")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX idx_monitoringSSHHosts_userId ON monitoringSSHHosts (userId)"
    ],
    "name": "monitoringSSHHosts"
  }, collection)

  // remove field
  collection.fields.removeById("select2363381545")

  // remove field
  collection.fields.removeById("json3949473096")

  return app.save(collection)
})
