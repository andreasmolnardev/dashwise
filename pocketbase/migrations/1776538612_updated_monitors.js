/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "json3626472599",
    "maxSize": 0,
    "name": "pings",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // remove field
  collection.fields.removeById("json3626472599")

  return app.save(collection)
})
