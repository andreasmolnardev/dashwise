/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const integrations = app.findCollectionByNameOrId("integrations");
  const typeField = integrations.fields.getByName("type");
  if (typeField && typeField.type() === "select" && !typeField.values.includes("sdk")) {
    integrations.fields.add(new SelectField({
      hidden: typeField.hidden,
      id: typeField.id,
      maxSelect: typeField.maxSelect,
      name: typeField.name,
      presentable: typeField.presentable,
      required: typeField.required,
      system: typeField.system,
      values: [...typeField.values, "sdk"],
    }));
  }
  if (!integrations.fields.getByName("sdkConfig")) {
    integrations.fields.add(new Field({
      hidden: true,
      id: "textSdkConfig001",
      max: 0,
      min: 0,
      name: "sdkConfig",
      presentable: false,
      required: false,
      system: false,
      type: "text",
    }));
  }

  return app.save(integrations);
}, (app) => {
  const integrations = app.findCollectionByNameOrId("integrations");
  integrations.fields.removeByName("sdkConfig");
  const typeField = integrations.fields.getByName("type");
  if (typeField && typeField.type() === "select") {
    integrations.fields.add(new SelectField({
      hidden: typeField.hidden,
      id: typeField.id,
      maxSelect: typeField.maxSelect,
      name: typeField.name,
      presentable: typeField.presentable,
      required: typeField.required,
      system: typeField.system,
      values: typeField.values.filter((value) => value !== "sdk"),
    }));
  }
  return app.save(integrations);
});
