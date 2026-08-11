/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");

  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "text_news_feed_type",
    "max": 20,
    "min": 0,
    "name": "feedType",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }));
  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "text_news_system_key",
    "max": 40,
    "min": 0,
    "name": "systemKey",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }));

  const records = app.findRecordsByFilter("newsFeeds", "", "created", 10000, 0);
  const allByUser = {};
  for (const record of records) {
    const title = String(record.get("title") || "").trim().toLowerCase();
    const isAll = title === "all feed" || String(record.get("id") || "") === "all" ||
      String(record.get("systemKey") || "") === "all" || String(record.get("feedType") || "") === "all";
    if (!isAll) {
      record.set("feedType", "custom");
      app.save(record);
      continue;
    }

    const userId = String(record.get("userId") || "");
    const key = userId + ":all";
    if (allByUser[key]) {
      app.delete(record);
      continue;
    }
    record.set("feedType", "all");
    record.set("systemKey", "all");
    record.set("subscriptionRefs", []);
    app.save(record);
    allByUser[key] = record.id;
  }

  collection.indexes.push("CREATE UNIQUE INDEX idx_newsFeeds_user_systemKey ON newsFeeds (userId, systemKey) WHERE systemKey != ''");
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");
  collection.indexes = collection.indexes.filter((index) => !String(index).includes("idx_newsFeeds_user_systemKey"));
  collection.fields.removeById("text_news_system_key");
  collection.fields.removeById("text_news_feed_type");
  return app.save(collection);
});
