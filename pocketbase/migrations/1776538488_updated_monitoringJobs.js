/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // update collection data
  unmarshal({
    "name": "monitors"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2988754750")

  // update collection data
  unmarshal({
    "name": "monitoringJobs"
  }, collection)

  return app.save(collection)
})
