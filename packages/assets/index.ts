/// <reference path="./yaml.d.ts" />

import homeDefaults from "./defaults/home.json";
import defaultIntegrations from "./integrations/default.yaml";
import weatherIntegration from "./integrations/weather.yaml";

export const defaultHomeConfig = homeDefaults;
export const defaultIntegrationsBlueprint = defaultIntegrations;
export const weatherIntegrationBlueprint = weatherIntegration;