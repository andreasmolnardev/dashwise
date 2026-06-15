/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "bool3179553109",
    "name": "notifyOnStatusChange",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text4316053111",
    "max": 0,
    "min": 0,
    "name": "notifyTopicId",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // remove field
  collection.fields.removeById("bool3179553109")

  // remove field
  collection.fields.removeById("text4316053111")

  return app.save(collection)
})
