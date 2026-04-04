import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getIntegrationsAction(auth: ActionAuth, options?: { id?: string; resolveEndpoints?: boolean }) {
  return api.integrations.getIntegrationsAction({ auth, options });
}

export async function createIntegrationAction(auth: ActionAuth, payload: { name?: string; source?: string; config: unknown; environment?: unknown }) {
  return api.integrations.createIntegrationAction({ auth, payload });
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  return api.integrations.testIntegrationEndpointAction({ auth, target });
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  return api.integrations.getWidgetPropertiesAction({ auth, widgetSlug });
}

export async function getIntegrationWithWidgetAction(auth: ActionAuth, widgetKey: string) {
  return api.integrations.getIntegrationWithWidgetAction({ auth, widgetKey });
}
