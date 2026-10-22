/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const notificationItems = app.findCollectionByNameOrId("pbc_1477109113")
  const notificationTopics = app.findCollectionByNameOrId("pbc_2969282176")

  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": "@request.auth.id != '' && topicId.userId = @request.auth.id",
    "updateRule": null,
    "viewRule": "@request.auth.id != '' && topicId.userId = @request.auth.id"
  }, notificationItems)

  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": "@request.auth.id != '' && userId = @request.auth.id",
    "updateRule": null,
    "viewRule": "@request.auth.id != '' && userId = @request.auth.id"
  }, notificationTopics)

  app.save(notificationItems)
  return app.save(notificationTopics)
}, (app) => {
  const notificationItems = app.findCollectionByNameOrId("pbc_1477109113")
  const notificationTopics = app.findCollectionByNameOrId("pbc_2969282176")

  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "updateRule": null,
    "viewRule": null
  }, notificationItems)
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "updateRule": null,
    "viewRule": null
  }, notificationTopics)

  app.save(notificationItems)
  return app.save(notificationTopics)
})
