/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const integrations = app.findCollectionByNameOrId("integrations");
  if (!integrations.fields.getByName("sdkEnabled")) {
    integrations.fields.add(new Field({
      hidden: true,
      id: "boolSdkEnabled01",
      name: "sdkEnabled",
      presentable: false,
      required: false,
      system: false,
      type: "bool",
    }));
  }

  for (const record of app.findRecordsByFilter("integrations", 'type = "sdk"')) {
    record.set("sdkEnabled", true);
    app.save(record);
  }
  return app.save(integrations);
}, (app) => {
  const integrations = app.findCollectionByNameOrId("integrations");
  integrations.fields.removeByName("sdkEnabled");
  return app.save(integrations);
});
