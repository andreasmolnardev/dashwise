/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // remove field
  collection.fields.removeById("json74942977")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // add field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "json74942977",
    "maxSize": 0,
    "name": "subscriptions",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
