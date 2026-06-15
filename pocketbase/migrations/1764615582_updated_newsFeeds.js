/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // update collection data
  unmarshal({
    "viewRule": ""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2530530043")

  // update collection data
  unmarshal({
    "viewRule": null
  }, collection)

  return app.save(collection)
})
