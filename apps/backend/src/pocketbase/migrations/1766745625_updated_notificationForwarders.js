/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_632006882")

  // update collection data
  unmarshal({
    "createRule": "topic.userId = @request.auth.id",
    "deleteRule": "topic.userId = @request.auth.id",
    "updateRule": "topic.userId = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_632006882")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
