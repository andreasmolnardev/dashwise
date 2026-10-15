import restStatusExample from "@dashwise/integration-example-rest";
import homeAssistant from "@dashwise/integration-homeassistant";
import groovewise from "@dashwise/integration-groovewise";
import jellyfin from "@dashwise/integration-jellyfin";
import musicAssistant from "@dashwise/integration-music-assistant";
import type { IntegrationDefinition } from "@dashwise/integrations-sdk";
import { registerSdkIntegration } from "./catalog";

const definitions: IntegrationDefinition[] = [restStatusExample, homeAssistant, groovewise, jellyfin, musicAssistant];

for (const definition of definitions) registerSdkIntegration(definition);
