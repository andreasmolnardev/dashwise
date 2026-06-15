/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1477109113")

  // update collection data
  unmarshal({
    "createRule": "",
    "updateRule": ""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1477109113")

  // update collection data
  unmarshal({
    "createRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
