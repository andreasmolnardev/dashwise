/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // add field
  collection.fields.addAt(5, new Field({
    "help": "",
    "hidden": false,
    "id": "json174080743",
    "maxSize": 0,
    "name": "linkReplaceRule",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1838182079",
    "max": 0,
    "min": 0,
    "name": "fallbackThumbnailUrl",
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
  collection.fields.removeById("json174080743")

  // remove field
  collection.fields.removeById("text1838182079")

  return app.save(collection)
})
