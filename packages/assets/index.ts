/// <reference path="./yaml.d.ts" />

import homeDefaults from "./defaults/home.json";
import integrationsDefaults from "./defaults/integrations.json";
import shortcutsDefaults from "./defaults/shortcuts.json";
import defaultIntegrations from "./integrations/default.yaml";
import weatherIntegration from "./integrations/weather.yaml";

export const defaultHomeConfig = homeDefaults;
export const defaultIntegrationsManifest = integrationsDefaults;
export const defaultShortcutsManifest = shortcutsDefaults;
export const defaultIntegrationsBlueprint = defaultIntegrations;
export const weatherIntegrationBlueprint = weatherIntegration;