declare module "@dashwise/assets" {
  type IntegrationBlueprint = {
    configuration?: {
      glanceables?: unknown;
      widgets?: unknown;
    };
  };

  export const defaultHomeConfig: Record<string, unknown>;
  export const defaultIntegrationsManifest: Record<string, unknown>;
  export const defaultShortcutsManifest: Record<string, unknown>;
  export const defaultIntegrationsBlueprint: IntegrationBlueprint;
  export const weatherIntegrationBlueprint: IntegrationBlueprint;
}
