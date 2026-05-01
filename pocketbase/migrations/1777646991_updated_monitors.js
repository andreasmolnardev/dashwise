/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // remove field
  collection.fields.removeById("text3777094677")

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "json2194976363",
    "maxSize": 0,
    "name": "responseUpFilter",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3777094677",
    "max": 0,
    "min": 0,
    "name": "acceptedUpStatusCodes",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // remove field
  collection.fields.removeById("json2194976363")

  return app.save(collection)
})
