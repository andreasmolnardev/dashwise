/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451");
  const linksFolders = app.findCollectionByNameOrId("pbc_3048047481");

  linkItems.fields.addAt(10, new Field({
    "hidden": false,
    "id": "number_position",
    "name": "position",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }));

  linksFolders.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number_position_folder",
    "name": "position",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }));

  app.save(linkItems);
  app.save(linksFolders);
}, (app) => {
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451");
  const linksFolders = app.findCollectionByNameOrId("pbc_3048047481");

  linkItems.fields.removeById("number_position");
  linksFolders.fields.removeById("number_position_folder");

  app.save(linkItems);
  app.save(linksFolders);
})
