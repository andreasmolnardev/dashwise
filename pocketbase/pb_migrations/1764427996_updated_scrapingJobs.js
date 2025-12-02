/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2373755168")

  // update collection data
  unmarshal({
    "createRule": "userId = @request.auth.id",
    "deleteRule": "userId = @request.auth.id",
    "listRule": "userId = @request.auth.id",
    "updateRule": "userId = @request.auth.id",
    "viewRule": "userId = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2373755168")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "updateRule": null,
    "viewRule": null
  }, collection)

  return app.save(collection)
})
