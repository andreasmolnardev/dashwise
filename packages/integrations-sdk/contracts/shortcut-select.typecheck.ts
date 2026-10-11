import type {
  GlanceableContribution,
  IntegrationConfigSchema,
  IntegrationConfigValues,
  ResourceBindingValues,
  WidgetContribution,
} from "../index";
import { defineIntegration } from "../index";

const widget = {
  id: "entity-list",
  name: "Entity list",
  configSchema: {
    entity: {
      type: "shortcut-select",
      required: true,
      appIds: ["entities", "lights"],
      collectionIds: ["entities"],
    },
    selectedEntities: {
      type: "shortcut-select",
      multiple: true,
      required: true,
      appIds: ["entities"],
      collectionIds: ["entities", "sensors"],
    },
  },
} as const satisfies WidgetContribution;

const glanceable = {
  id: "room-temperature",
  name: "Room temperature",
  configSchema: {
    sensor: {
      type: "shortcut-select",
      appIds: ["sensors"],
      collectionIds: ["entities"],
    },
  },
  resourceBindings: {
    currentSensor: { type: "shortcut-select", configKey: "sensor" },
  },
} as const satisfies GlanceableContribution<{
  sensor: {
    type: "shortcut-select";
    appIds: readonly ["sensors"];
    collectionIds: readonly ["entities"];
  };
}>;

type WidgetValues = IntegrationConfigValues<NonNullable<typeof widget.configSchema>>;
type GlanceableValues = IntegrationConfigValues<NonNullable<typeof glanceable.configSchema>>;

const oneShortcut: WidgetValues["entity"] = "light.kitchen";
const manyShortcuts: WidgetValues["selectedEntities"] = ["light.kitchen", "light.hall"];
const optionalShortcut: GlanceableValues["sensor"] = undefined;

// @ts-expect-error Multiple selection settings are arrays of resource IDs.
const invalidMultipleValue: WidgetValues["selectedEntities"] = "light.kitchen";
// @ts-expect-error Single selection settings store one resource ID.
const invalidSingleValue: WidgetValues["entity"] = ["light.kitchen"];

const genericConfig: IntegrationConfigSchema = {
  selected: { type: "shortcut-select", multiple: true, appIds: ["entities"] },
};

const widgetSchema = {
  title: { type: "text", required: true },
  entity: { type: "shortcut-select", required: true, appIds: ["entities"] },
  selectedEntities: { type: "shortcut-select", multiple: true, collectionIds: ["entities"] },
} as const satisfies IntegrationConfigSchema;
const boundWidget = {
  id: "bound-entity-list",
  name: "Bound entity list",
  template: "columns",
  configSchema: widgetSchema,
  properties: {
    header: { title: "Selected entities" },
    columns: [{ id: "entity", primary: "${name}", secondary: "${state}" }],
  },
  exampleProps: { header: { title: "Preview entities" } },
  resourceBindings: {
    currentEntity: { type: "shortcut-select", configKey: "entity" },
    selectedEntities: { type: "shortcut-select", configKey: "selectedEntities" },
  },
} as const satisfies WidgetContribution<typeof widgetSchema>;

type WidgetData = ResourceBindingValues<
  typeof widgetSchema,
  NonNullable<typeof boundWidget.resourceBindings>
>;
const singleResolvedResource: WidgetData["currentEntity"] = { id: "light.kitchen", name: "Kitchen light" };
const multipleResolvedResources: WidgetData["selectedEntities"] = [
  { id: "light.kitchen", name: "Kitchen light" },
  { id: "light.hall", name: "Hall light" },
];
const missingSingleResolvedResource: WidgetData["currentEntity"] = undefined;

const invalidBinding: WidgetContribution<typeof widgetSchema> = {
  id: "invalid-binding",
  name: "Invalid binding",
  configSchema: widgetSchema,
  resourceBindings: {
    // @ts-expect-error Bindings must refer to a shortcut-select config field.
    invalid: { type: "shortcut-select", configKey: "title" },
  },
};

const inferredDefinition = defineIntegration({
  id: "inference-contract",
  name: "Inference contract",
  version: "1.0.0",
  config: {},
  resources: {},
  widgets: [{
    id: "bound-widget",
    name: "Bound widget",
    template: "vertical-list",
    properties: { list: [{ title: "${entities.0.name}" }] },
    exampleProps: { list: [{ title: "Example entity" }] },
    configSchema: {
      selected: { type: "shortcut-select", multiple: true },
    },
    resourceBindings: {
      entities: { type: "shortcut-select", configKey: "selected" },
    },
  }],
  glanceables: [{
    id: "bound-glanceable",
    name: "Bound glanceable",
    icon: { file: "mdi:thermometer", size: 16, description: "Sensor value" },
    text: "${current.state}",
    columns: [{ icon: "mdi:thermometer", text: "${current.state}", format: "time" }],
    properties: { unit: "°C" },
    exampleProps: { state: "21.5" },
    configSchema: {
      sensor: { type: "shortcut-select" },
    },
    resourceBindings: {
      current: { type: "shortcut-select", configKey: "sensor" },
    },
  }],
});

type InferredWidget = NonNullable<typeof inferredDefinition.widgets>[number];
type InferredGlanceable = NonNullable<typeof inferredDefinition.glanceables>[number];
type WidgetBindingConfigKey = InferredWidget["resourceBindings"] extends {
  entities: { configKey: infer ConfigKey };
} ? ConfigKey : never;
type GlanceableBindingConfigKey = InferredGlanceable["resourceBindings"] extends {
  current: { configKey: infer ConfigKey };
} ? ConfigKey : never;
type IsEqual<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
const widgetConfigKeyIsInferred: IsEqual<WidgetBindingConfigKey, "selected"> = true;
const glanceableConfigKeyIsInferred: IsEqual<GlanceableBindingConfigKey, "sensor"> = true;

// @ts-expect-error Presentation properties contain JSON values, never executable callbacks.
const unsafePresentation: WidgetContribution["properties"] = { render: () => "custom UI" };

void [
  oneShortcut,
  manyShortcuts,
  optionalShortcut,
  invalidMultipleValue,
  invalidSingleValue,
  genericConfig,
  singleResolvedResource,
  multipleResolvedResources,
  missingSingleResolvedResource,
  invalidBinding,
  inferredDefinition,
  widgetConfigKeyIsInferred,
  glanceableConfigKeyIsInferred,
  unsafePresentation,
];
