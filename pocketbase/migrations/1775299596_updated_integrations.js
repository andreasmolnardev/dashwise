/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_733358252")

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "json1545881475",
    "maxSize": 0,
    "name": "localData",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_733358252")

  // remove field
  collection.fields.removeById("json1545881475")

  return app.save(collection)
})
