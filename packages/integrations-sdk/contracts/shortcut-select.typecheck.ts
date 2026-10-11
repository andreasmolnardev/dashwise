import type {
  GlanceableContribution,
  IntegrationConfigSchema,
  IntegrationConfigValues,
  WidgetContribution,
} from "../index";

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
} as const satisfies GlanceableContribution;

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

void [oneShortcut, manyShortcuts, optionalShortcut, invalidMultipleValue, invalidSingleValue, genericConfig];
