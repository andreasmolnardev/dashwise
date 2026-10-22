/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const linksLists = app.findCollectionByNameOrId("pbc_3900840354")
  const linksFolders = app.findCollectionByNameOrId("pbc_3048047481")
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451")
  const linksTags = app.findCollectionByNameOrId("pbc_517180716")

  linksTags.fields.addAt(3, new Field({
    "cascadeDelete": true,
    "collectionId": "_pb_users_auth_",
    "hidden": false,
    "id": "relation_links_tags_user",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "user",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  unmarshal({
    "createRule": "@request.auth.id != '' && @request.body.user = @request.auth.id",
    "deleteRule": "@request.auth.id != '' && user = @request.auth.id",
    "listRule": "@request.auth.id != '' && user = @request.auth.id",
    "updateRule": "@request.auth.id != '' && user = @request.auth.id && @request.body.user:changed = false",
    "viewRule": "@request.auth.id != '' && user = @request.auth.id"
  }, linksLists)

  unmarshal({
    "createRule": "@request.auth.id != '' && @request.body.list.user = @request.auth.id",
    "deleteRule": "@request.auth.id != '' && list.user = @request.auth.id",
    "listRule": "@request.auth.id != '' && list.user = @request.auth.id",
    "updateRule": "@request.auth.id != '' && list.user = @request.auth.id && @request.body.list:changed = false",
    "viewRule": "@request.auth.id != '' && list.user = @request.auth.id"
  }, linksFolders)

  unmarshal({
    "createRule": "@request.auth.id != '' && @request.body.collection.user = @request.auth.id",
    "deleteRule": "@request.auth.id != '' && collection.user = @request.auth.id",
    "listRule": "@request.auth.id != '' && collection.user = @request.auth.id",
    "updateRule": "@request.auth.id != '' && collection.user = @request.auth.id && @request.body.collection:changed = false",
    "viewRule": "@request.auth.id != '' && collection.user = @request.auth.id"
  }, linkItems)

  unmarshal({
    "createRule": "@request.auth.id != '' && @request.body.user = @request.auth.id",
    "deleteRule": "@request.auth.id != '' && user = @request.auth.id",
    "listRule": "@request.auth.id != '' && user = @request.auth.id",
    "updateRule": "@request.auth.id != '' && user = @request.auth.id && @request.body.user:changed = false",
    "viewRule": "@request.auth.id != '' && user = @request.auth.id"
  }, linksTags)

  app.save(linksLists)
  app.save(linksFolders)
  app.save(linkItems)
  return app.save(linksTags)
}, (app) => {
  const linksLists = app.findCollectionByNameOrId("pbc_3900840354")
  const linksFolders = app.findCollectionByNameOrId("pbc_3048047481")
  const linkItems = app.findCollectionByNameOrId("pbc_2828452451")
  const linksTags = app.findCollectionByNameOrId("pbc_517180716")

  for (const collection of [linksLists, linksFolders, linkItems, linksTags]) {
    unmarshal({
      "createRule": null,
      "deleteRule": null,
      "listRule": null,
      "updateRule": null,
      "viewRule": null
    }, collection)
  }
  linksTags.fields.removeById("relation_links_tags_user")

  app.save(linksLists)
  app.save(linksFolders)
  app.save(linkItems)
  return app.save(linksTags)
})
