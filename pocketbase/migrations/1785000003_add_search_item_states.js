/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3591471183")

  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "json_searchItemStates",
    "maxSize": 0,
    "name": "states",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3591471183")
  collection.fields.removeById("json_searchItemStates")
  return app.save(collection)
})
