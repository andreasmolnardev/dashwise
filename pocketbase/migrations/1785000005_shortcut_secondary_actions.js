/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const shortcuts = app.findCollectionByNameOrId("pbc_3591471183");
  shortcuts.fields.addAt(shortcuts.fields.length, new Field({
    "hidden": false,
    "id": "bool_isDisabled",
    "name": "isDisabled",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }));
  shortcuts.fields.addAt(shortcuts.fields.length, new Field({
    "help": "JSON map of secondary action labels to action values",
    "hidden": false,
    "id": "json_secondaryActions",
    "maxSize": 0,
    "name": "secondaryActions",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }));
  return app.save(shortcuts);
}, (app) => {
  const shortcuts = app.findCollectionByNameOrId("pbc_3591471183");
  shortcuts.fields.removeById("json_secondaryActions");
  shortcuts.fields.removeById("bool_isDisabled");
  return app.save(shortcuts);
});
