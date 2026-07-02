/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "hidden": false,
    "id": "relation2148753096",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "userId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "autogeneratePattern": "",
    "help": "Comma-separated topic grouping words to ignore. Prefix a default/global word with - to allow it.",
    "hidden": false,
    "id": "text3188297401",
    "max": 0,
    "min": 0,
    "name": "similarityGroupingWordsBlacklist",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "bool2197385116",
    "name": "enableTopicGrouping",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_newsSubscriptions_userId` ON `newsSubscriptions` (`userId`)"
    ]
  }, collection)

  app.save(collection)

  const subscriptions = app.findRecordsByFilter("newsSubscriptions", "", "", 10000, 0)
  for (const subscription of subscriptions) {
    subscription.set("enableTopicGrouping", true)
    app.save(subscription)
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957")

  const subscriptions = app.findRecordsByFilter("newsSubscriptions", "", "", 10000, 0)
  for (const subscription of subscriptions) {
    subscription.set("enableTopicGrouping", false)
    app.save(subscription)
  }

  // remove field
  collection.fields.removeById("relation2148753096")

  // remove field
  collection.fields.removeById("text3188297401")

  // remove field
  collection.fields.removeById("bool2197385116")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
