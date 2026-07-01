/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const lists = new Collection({
    "createRule": null,
    "deleteRule": null,
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
        "id": "text2193810834",
        "max": 0,
        "min": 0,
        "name": "name",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "_pb_users_auth_",
        "hidden": false,
        "id": "relation2839102431",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "userId",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
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
    "id": "pbc_1781992300",
    "indexes": ["CREATE UNIQUE INDEX `idx_newsSavedArticleLists_user_name` ON `newsSavedArticleLists` (`userId`, `name`)"] ,
    "listRule": null,
    "name": "newsSavedArticleLists",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  app.save(lists);

  const articleListRefs = [];
  const listByUserAndName = {};
  const existingArticles = app.findRecordsByFilter("newsSavedArticles", "", "", 10000, 0);
  for (const article of existingArticles) {
    const userId = String(article.get("userId") || "");
    const listName = String(article.get("list") || "").trim() || "readLater";
    const key = `${userId}:${listName}`;

    if (!listByUserAndName[key]) {
      const listRecord = new Record(lists);
      listRecord.set("name", listName);
      if (userId) {
        listRecord.set("userId", userId);
      }
      app.save(listRecord);
      listByUserAndName[key] = listRecord.id;
    }

    articleListRefs.push({ id: article.id, listId: listByUserAndName[key] });
  }

  const articles = app.findCollectionByNameOrId("pbc_708912430");
  articles.fields.removeByName("list");
  articles.fields.addAt(1, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_1781992300",
    "hidden": false,
    "id": "relation3719284361",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "list",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }));

  app.save(articles);

  for (const ref of articleListRefs) {
    const article = app.findRecordById("newsSavedArticles", ref.id);
    article.set("list", [ref.listId]);
    app.save(article);
  }

}, (app) => {
  const articles = app.findCollectionByNameOrId("pbc_708912430");
  articles.fields.removeById("relation3719284361");
  articles.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1154021400",
    "max": 0,
    "min": 0,
    "name": "list",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }));
  app.save(articles);

  const lists = app.findCollectionByNameOrId("pbc_1781992300");
  return app.delete(lists);
})
