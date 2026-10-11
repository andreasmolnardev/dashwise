import restStatusExample from "@dashwise/integration-example-rest";
import type { IntegrationDefinition } from "@dashwise/integrations-sdk";
import { registerSdkIntegration } from "./catalog";

const definitions: IntegrationDefinition[] = [restStatusExample];

for (const definition of definitions) registerSdkIntegration(definition);
