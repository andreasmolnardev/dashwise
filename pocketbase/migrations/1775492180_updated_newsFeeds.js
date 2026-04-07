/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // add field
  collection.fields.addAt(3, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_3454427957",
    "hidden": false,
    "id": "relation1572276808",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "subscriptionRefs",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // remove field
  collection.fields.removeById("relation1572276808")

  return app.save(collection)
})
