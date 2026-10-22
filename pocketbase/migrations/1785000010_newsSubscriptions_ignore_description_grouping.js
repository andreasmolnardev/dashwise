/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957");
  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "bool4591028347",
    "name": "ignoreDescriptionForTopicGrouping",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3454427957");
  try {
    collection.fields.removeByName("ignoreDescriptionForTopicGrouping");
  } catch (_) {
    // Older installs may not have the field.
  }
  return app.save(collection);
});
