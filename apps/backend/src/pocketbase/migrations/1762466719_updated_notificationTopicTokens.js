/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3541236139")

  // update collection data
  unmarshal({
    "createRule": "topic.userId = @request.auth.id",
    "deleteRule": "topic.userId = @request.auth.id",
    "updateRule": "topic.userId = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3541236139")

  // update collection data
  unmarshal({
    "createRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id",
    "deleteRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id",
    "updateRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id"
  }, collection)

  return app.save(collection)
})
