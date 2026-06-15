/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // add field
  collection.fields.addAt(8, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2828452451",
    "hidden": false,
    "id": "relation3187259873",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "sourcelinkId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // remove field
  collection.fields.removeById("relation3187259873")

  return app.save(collection)
})
