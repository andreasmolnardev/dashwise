/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");
  const cacheField = collection.fields.getByName("feedCache");
  if (cacheField) collection.fields.removeById(cacheField.id);
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("newsFeeds");
  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": true,
    "id": "json1563746223",
    "maxSize": 0,
    "name": "feedCache",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }));
  return app.save(collection);
});
