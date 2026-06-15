/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text342134626",
    "max": 0,
    "min": 0,
    "name": "thumbnailOverwriteUrl",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // remove field
  collection.fields.removeById("text342134626")

  return app.save(collection)
})
