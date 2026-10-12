import restStatusExample from "@dashwise/integration-example-rest";
import homeAssistant from "@dashwise/integration-homeassistant";
import type { IntegrationDefinition } from "@dashwise/integrations-sdk";
import { registerSdkIntegration } from "./catalog";

const definitions: IntegrationDefinition[] = [restStatusExample, homeAssistant];

for (const definition of definitions) registerSdkIntegration(definition);
