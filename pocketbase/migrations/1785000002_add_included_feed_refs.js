/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");
  collection.fields.addAt(collection.fields.length, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_2530530043",
    "hidden": false,
    "id": "relation_news_feed_included_refs",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "includedFeedRefs",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");
  collection.fields.removeById("relation_news_feed_included_refs");
  return app.save(collection);
});
