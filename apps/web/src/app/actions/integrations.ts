import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getIntegrationsAction(auth: ActionAuth, options?: { id?: string; resolveEndpoints?: boolean }) {
  return api.integrations.getIntegrationsAction.query({ auth, options });
}

export async function createIntegrationAction(auth: ActionAuth, payload: { name?: string; source?: string; config: unknown; environment?: unknown }) {
  return api.integrations.createIntegrationAction.mutate({ auth, payload });
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  return api.integrations.testIntegrationEndpointAction.mutate({ auth, target });
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  return api.integrations.getWidgetPropertiesAction.query({ auth, widgetSlug });
}

export async function getIntegrationWithWidgetAction(auth: ActionAuth, widgetKey: string) {
  return api.integrations.getIntegrationWithWidgetAction.query({ auth, widgetKey });
}
