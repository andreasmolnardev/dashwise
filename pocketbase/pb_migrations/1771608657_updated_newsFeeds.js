/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // remove field
  collection.fields.removeById("json591414443")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "json591414443",
    "maxSize": 0,
    "name": "feed",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
