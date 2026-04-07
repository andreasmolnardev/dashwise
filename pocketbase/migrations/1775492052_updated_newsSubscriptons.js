/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // update collection data
  unmarshal({
    "name": "newsSubscriptions"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // update collection data
  unmarshal({
    "name": "newsSubscriptons"
  }, collection)

  return app.save(collection)
})
