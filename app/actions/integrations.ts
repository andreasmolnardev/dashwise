"use server";

import { ActionAuth, requireUserAuth } from "@/dashwise-sdk/data/auth";
import {
  createIntegration,
  getIntegration,
  getWidgetProperties,
  listIntegrations,
  testIntegrationEndpoint,
} from "@/dashwise-sdk/data/integrations";
import { getWeatherData } from "@dashwise/sdk/data/widgets";

export async function getIntegrationsAction(
  auth: ActionAuth,
  options?: { id?: string; resolveEndpoints?: boolean }
) {
  const { userId } = await requireUserAuth(auth);

  if (options?.id) {
    return getIntegration(userId, options.id, !!options.resolveEndpoints);
  }

  return listIntegrations(userId);
}

export async function createIntegrationAction(
  auth: ActionAuth,
  payload: { name?: string; source?: string; config: unknown; environment?: unknown }
) {
  const { userId } = await requireUserAuth(auth);
  return createIntegration(userId, payload);
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  const { userId } = await requireUserAuth(auth);
  try {
    return await testIntegrationEndpoint(userId, target);
  } catch (error) {
    console.error("[Integrations Action] testIntegrationEndpointAction failed", {
      target,
      error,
    });
    throw error;
  }
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  const { userId } = await requireUserAuth(auth);
  console.log(`[Integrations Action] Fetching widget properties for slug: ${widgetSlug}`);
  return getWidgetProperties(userId, widgetSlug);
}

export async function getWeatherAction({ lat, lon, unit = "c" }: { lat: string; lon: string; unit?: string }) {
  if (!lat || !lon) {
    throw new Error("Missing lat/lon");
  }

  return getWeatherData({ lat: String(lat), lon: String(lon), unit });
}
