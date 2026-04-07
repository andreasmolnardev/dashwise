/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // update collection data
  unmarshal({
    "name": "newsSubscriptons"
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1704208859",
    "max": 0,
    "min": 0,
    "name": "icon",
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

  // update collection data
  unmarshal({
    "name": "newsFeedItemsCache"
  }, collection)

  // remove field
  collection.fields.removeById("text1704208859")

  return app.save(collection)
})
