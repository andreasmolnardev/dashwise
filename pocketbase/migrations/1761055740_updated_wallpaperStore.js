/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2882600305")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id = userId"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2882600305")

  // update collection data
  unmarshal({
    "deleteRule": null
  }, collection)

  return app.save(collection)
})
