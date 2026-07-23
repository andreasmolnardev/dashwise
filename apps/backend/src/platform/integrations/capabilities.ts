export type IntegrationCapability =
  | "endpoints"
  | "widgets"
  | "glanceables"
  | "shortcuts"
  | "calendar";

export type IntegrationCapabilities = ReadonlySet<IntegrationCapability>;

export type IntegrationCapabilitySource = {
  type?: "plugin" | "caldav";
  config: Record<string, unknown>;
};

type IntegrationConfiguration = Record<string, unknown>;

/** Maps current integration-definition sections to platform consumer capabilities. */
export function getIntegrationCapabilities(
  integration: IntegrationCapabilitySource,
): IntegrationCapabilities {
  const configuration = asRecord(integration.config.configuration);
  const capabilities = new Set<IntegrationCapability>();

  if (Array.isArray(configuration?.endpoints)) capabilities.add("endpoints");
  if (Array.isArray(configuration?.widgets)) capabilities.add("widgets");
  if (Array.isArray(configuration?.glanceables)) capabilities.add("glanceables");
  if (Array.isArray(configuration?.shortcuts)) capabilities.add("shortcuts");
  if (integration.type === "caldav") capabilities.add("calendar");

  return capabilities;
}

function asRecord(value: unknown): IntegrationConfiguration | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as IntegrationConfiguration)
    : null;
}
