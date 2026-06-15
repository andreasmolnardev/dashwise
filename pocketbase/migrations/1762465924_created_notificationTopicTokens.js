/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id",
    "deleteRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1597481275",
        "max": 0,
        "min": 0,
        "name": "token",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_2969282176",
        "hidden": false,
        "id": "relation2638274075",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "topic",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "date2593941644",
        "max": "",
        "min": "",
        "name": "expires",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_3541236139",
    "indexes": [],
    "listRule": "topic.userId = @request.auth.id",
    "name": "notificationTopicTokens",
    "system": false,
    "type": "base",
    "updateRule": "@request.body.topic.notificationTopicTokens_via_topic.userId = @request.auth.id",
    "viewRule": "topic.userId = @request.auth.id"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3541236139");

  return app.delete(collection);
})
