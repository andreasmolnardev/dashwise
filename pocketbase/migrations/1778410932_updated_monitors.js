/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1194904800",
    "max": 0,
    "min": 0,
    "name": "pingAvgLatency",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "json3716237166",
    "maxSize": 0,
    "name": "pingOutliers",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "json3284801801",
    "maxSize": 0,
    "name": "pingOutlierThreshold",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // remove field
  collection.fields.removeById("text1194904800")

  // remove field
  collection.fields.removeById("json3716237166")

  // remove field
  collection.fields.removeById("json3284801801")

  return app.save(collection)
})
