/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3957763459")

  // remove field
  collection.fields.removeById("number3449329895")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3957763459")

  // add field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "number3449329895",
    "max": null,
    "min": null,
    "name": "updateAvailable",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
