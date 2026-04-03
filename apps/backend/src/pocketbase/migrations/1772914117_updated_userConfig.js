/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3779370597")

  // update collection data
  unmarshal({
    "name": "pageConfig"
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2143666259",
    "max": 0,
    "min": 0,
    "name": "pageName",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3779370597")

  // update collection data
  unmarshal({
    "name": "userConfig"
  }, collection)

  // remove field
  collection.fields.removeById("text2143666259")

  return app.save(collection)
})
