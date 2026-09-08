/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451");

  linkItems.fields.addAt(5, new Field({
    "hidden": false,
    "id": "json_secondary_urls",
    "maxSize": 0,
    "name": "secondaryUrls",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }));

  return app.save(linkItems);
}, (app) => {
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451");
  linkItems.fields.removeById("json_secondary_urls");
  return app.save(linkItems);
});
