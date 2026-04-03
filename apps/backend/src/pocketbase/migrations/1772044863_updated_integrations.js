/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_733358252")

  collection.fields.removeById("file3565825916")

  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "json3565825916",
    "maxSize": 0,
    "name": "config",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_733358252")

  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "file3565825916",
    "maxSelect": 1,
    "maxSize": 0,
    "mimeTypes": [],
    "name": "config",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  collection.fields.removeById("json3565825916")

  return app.save(collection)
})
