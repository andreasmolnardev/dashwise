import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getIntegrationsAction(
  auth: ActionAuth,
  options?: { id?: string; resolveEndpoints?: boolean }
) {
  return callAction("integrations", "getIntegrationsAction", [auth, options]);
}

export async function createIntegrationAction(
  auth: ActionAuth,
  payload: { name?: string; source?: string; config: unknown; environment?: unknown }
) {
  return callAction("integrations", "createIntegrationAction", [auth, payload]);
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  return callAction("integrations", "testIntegrationEndpointAction", [auth, target]);
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  return callAction("integrations", "getWidgetPropertiesAction", [auth, widgetSlug]);
}

export async function getIntegrationWithWidgetAction(auth: ActionAuth, widgetKey: string) {
  return callAction("integrations", "getIntegrationWithWidgetAction", [auth, widgetKey]);
}