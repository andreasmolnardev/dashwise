/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // remove field
  collection.fields.removeById("json1563746223")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "json1563746223",
    "maxSize": 0,
    "name": "feedCache",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
