import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getIntegrationsAction(auth: ActionAuth, options?: { id?: string; resolveEndpoints?: boolean }) {
  return callApiAction("integrations", "getIntegrationsAction", { auth, options });
}

export async function createIntegrationAction(auth: ActionAuth, payload: { name?: string; source?: string; config: unknown; environment?: unknown }) {
  return callApiAction("integrations", "createIntegrationAction", { auth, payload });
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  return callApiAction("integrations", "testIntegrationEndpointAction", { auth, target });
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  return callApiAction("integrations", "getWidgetPropertiesAction", { auth, widgetSlug });
}

export async function getIntegrationWithWidgetAction(auth: ActionAuth, widgetKey: string) {
  return callApiAction("widgets", "getIntegrationWithWidgetAction", { auth, widgetKey });
}

export async function getConsumerDataAction(
  auth: ActionAuth,
  key: string,
  properties?: Record<string, any>,
  options?: {
    type?: "widget" | "glanceable";
    isPreview?: boolean;
  },
) {
  return callApiAction("integrations", "getConsumerDataAction", {
    auth,
    key,
    properties,
    type: options?.type,
    isPreview: options?.isPreview,
  });
}

export async function getIntegrationCalendarEventsAction(auth: ActionAuth, integrationId?: string) {
  return callApiAction("integrations", "getIntegrationCalendarEventsAction", { auth, integrationId });
}
