import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { isSessionActive } from "../lib/data/sessions";
import { getNotifications } from "../lib/data/notifications/items";
import { listIntegrations } from "../lib/data/integrations";
import { getUpcomingEvents } from "../lib/calendar";
import { listActivities } from "../lib/data/activities";
import { getOwnedSdkInstance } from "../lib/integrations-sdk/persistence";
import { requireSdkIntegrationDefinition } from "../lib/integrations-sdk/catalog";
import { listSdkResourceSnapshot } from "../lib/integrations-sdk/runtime";
import {
  type ActivityConnection,
  handleActivityMessage,
  registerSessionConnection,
  subscribeActivity,
  subscribeSdkResourceRevisions,
} from "../lib/activity";
import { trackSessionConnection, type SessionConnection } from "../lib/session-connections";
import { requireAuth } from "./shared";
import { getPageConfigJSON } from "../lib/data/pageConfig";
import { normalizePageName } from "./shared";
import { collectPageConsumers } from "./pageConfig.route";
import { resolveConsumerDataForRequest } from "./integrations.route";
import { getSharedPageWidgetSnapshot } from "../lib/pageWidgetSnapshots";

const activityRoute = new Hono();
export const activityWebSocketServerOptions = websocket;

activityRoute.get("/api/v1/activity",  upgradeWebSocket((c) => {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let pageRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let activePageId: string | undefined;
  let unsubscribeActivity: (() => void) | undefined;
  let unsubscribeSdkResources: (() => void) | undefined;
  let unregisterSessionConnection: (() => void) | undefined;
  let lifecycle: SessionConnection | undefined;
  let sendPageWidgets: ((pageId: string) => Promise<void>) | undefined;
  let closed = false;
  const cleanup = () => {
    closed = true;
    if (refreshTimer) clearInterval(refreshTimer);
    if (pageRefreshTimer) clearInterval(pageRefreshTimer);
    unsubscribeActivity?.();
    unsubscribeSdkResources?.();
    unregisterSessionConnection?.();
    lifecycle?.dispose();
  };
  let activityConnection: ActivityConnection | undefined;
  let connectedUserId = "";
  let connectedSessionId = "";
  const sdkResourceIdentities = new Set<string>();
  const resourceIdentity = (value: { instanceId: string; collectionId: string; resourceId: string }) =>
    `${value.instanceId}\0${value.collectionId}\0${value.resourceId}`;

  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || "";
      const requestedSessionId = c.req.query("sessionId") || c.req.header("x-session-id") || null;
      try {
        const { userId, pb, sessionId } = await requireAuth({ token, sessionId: requestedSessionId });
        if (closed) return;
        lifecycle = trackSessionConnection({ userId, sessionId,
          validate: () => isSessionActive(userId, sessionId),
          close: () => { cleanup(); ws.close(1008, "Session ended"); },
        });
        if (!await lifecycle.ensureValid() || !lifecycle?.isActive()) return;
        connectedUserId = userId;
        connectedSessionId = sessionId;
        activityConnection = {
          send(data) {
            void lifecycle?.ensureValid().then((valid) => {
              if (valid && lifecycle?.isActive()) {
                try { ws.send(data); } catch { cleanup(); }
              }
            });
          },
        };
        unregisterSessionConnection = registerSessionConnection(userId, sessionId, activityConnection);
        unsubscribeSdkResources = subscribeSdkResourceRevisions(userId, (event) => {
          if (!sdkResourceIdentities.has(resourceIdentity(event))) return;
          void lifecycle?.ensureValid().then((valid) => {
            if (valid && lifecycle?.isActive()) {
              try { ws.send(JSON.stringify({ type: "sdk:resource-revision", ...event })); } catch { cleanup(); }
            }
          });
        });
        let calendarEvents: Array<Record<string, any>> = [];
        let calendarRefreshedAt = 0;
        let calendarRefresh: Promise<void> | null = null;
        const refreshCalendarEvents = async () => {
          if (Date.now() - calendarRefreshedAt < 5 * 60 * 1000) return;
          if (calendarRefresh) return calendarRefresh;

          calendarRefresh = (async () => {
            const integrationResult = await listIntegrations(userId);
            calendarEvents = (await Promise.all(
              integrationResult.integrations
                .filter((integration) => integration.type === "caldav")
                .map((integration) => getUpcomingEvents(
                  integration.environment,
                  integration.localData,
                  (localData) => pb.collection("integrations").update(integration.id, { localData }).then(() => undefined),
                ).then((events) => events.map((event) => ({ ...event, id: `${integration.id}:${event.id}` }))).catch(() => [])),
            )).flat().filter((event) => new Date(event.start).getTime() >= new Date().setHours(0, 0, 0, 0));
            calendarRefreshedAt = Date.now();
          })().finally(() => {
            calendarRefresh = null;
          });

          return calendarRefresh;
        };
        const sendSnapshot = async () => {
          if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
          const [notificationResult, activityResult] = await Promise.all([
            getNotifications(userId),
            listActivities(userId, { page: 1, perPage: 20 }),
            refreshCalendarEvents(),
          ]);
          if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
          ws.send(JSON.stringify({
            type: "activity:snapshot",
            notifications: notificationResult.items,
            calendarEvents,
            activities: activityResult.items,
          }));
        };

        sendPageWidgets = async (pageId: string) => {
          if (pageId !== activePageId || !await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
          const items = await getSharedPageWidgetSnapshot(userId, pageId, async () => {
            const pageName = normalizePageName(pageId);
            const pageConfig = (await getPageConfigJSON(userId, pageName)) ?? {};
            const consumers = collectPageConsumers(pageConfig);
            const sharedRuntimeCache = new Map<string, any>();
            return Promise.all(consumers.map(async (consumer) => {
            let item: Record<string, unknown>;
            try {
              const payload = await resolveConsumerDataForRequest({
                userId,
                pb,
                type: consumer.consumer,
                key: consumer.key,
                properties: consumer.properties,
                isPreview: false,
                sharedRuntimeCache,
              });
              item = {
                consumer: consumer.consumer,
                key: consumer.key,
                properties: consumer.properties,
                integrationId: payload.integrationId ?? null,
                consumerKey: consumer.consumerKey,
                success: true,
                data: payload.data,
                blueprint: payload.blueprint,
              };
            } catch (error) {
              item = {
                consumer: consumer.consumer,
                key: consumer.key,
                properties: consumer.properties,
                integrationId: null,
                consumerKey: consumer.consumerKey,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
            return item;
            }));
          });
          if (pageId !== activePageId || !await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
          for (const item of items) ws.send(JSON.stringify({ type: "page-widget", pageId, item }));
        };

        unsubscribeActivity = subscribeActivity(userId, sendSnapshot);
        await sendSnapshot();
        if (!lifecycle?.isActive()) return;
        refreshTimer = setInterval(() => void sendSnapshot().catch(() => undefined), 30_000);
        (ws as typeof ws & { data: { sendSnapshot: () => Promise<void> } }).data = { sendSnapshot };
      } catch {
        ws.close(1008, "Unauthorized");
      }
    },
    async onMessage(event, ws) {
      if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "sdk:resources:subscribe" && Array.isArray(message.resources)) {
          const requested = message.resources.filter((resource: unknown) =>
            Boolean(resource && typeof resource === "object"
              && typeof (resource as Record<string, unknown>).instanceId === "string"
              && typeof (resource as Record<string, unknown>).collectionId === "string"
              && typeof (resource as Record<string, unknown>).resourceId === "string"),
          ).slice(0, 200) as Array<{ instanceId: string; collectionId: string; resourceId: string }>;
          const accepted: typeof requested = [];
          const resourcesByInstance = new Map<string, Awaited<ReturnType<typeof listSdkResourceSnapshot>>>();
          for (const identity of requested) {
            const { instanceId, collectionId, resourceId } = identity;
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)
              || !/^[A-Za-z0-9._-]{1,120}$/.test(collectionId)
              || !/^[A-Za-z0-9._:-]{1,200}$/.test(resourceId)) continue;
            try {
              const { instance } = await getOwnedSdkInstance(connectedUserId, instanceId);
              if (!requireSdkIntegrationDefinition(instance.source).resources[collectionId]) continue;
              sdkResourceIdentities.add(resourceIdentity(identity));
              accepted.push(identity);
              if (!resourcesByInstance.has(instanceId)) resourcesByInstance.set(instanceId, await listSdkResourceSnapshot(connectedUserId, instanceId));
            } catch {
              sdkResourceIdentities.delete(resourceIdentity(identity));
            }
          }
          ws.send(JSON.stringify({ type: "sdk:resources:subscribed", resources: accepted }));
          for (const identity of accepted) {
            const current = resourcesByInstance.get(identity.instanceId)?.find((resource) =>
              resource.collectionId === identity.collectionId && resource.id === identity.resourceId);
            ws.send(JSON.stringify({
              type: "sdk:resource-revision",
              ...identity,
              revision: current?.revision ?? 0,
              operation: current ? "upsert" : "remove",
            }));
          }
          return;
        }
        if (message.type === "sdk:resources:unsubscribe" && Array.isArray(message.resources)) {
          for (const identity of message.resources) {
            if (identity && typeof identity === "object"
              && typeof identity.instanceId === "string"
              && typeof identity.collectionId === "string"
              && typeof identity.resourceId === "string") {
              sdkResourceIdentities.delete(resourceIdentity(identity));
            }
          }
          return;
        }
        if (message.type === "page-hello" && typeof message.pageId === "string" && message.pageId.length <= 128) {
          activePageId = normalizePageName(message.pageId);
          if (pageRefreshTimer) clearInterval(pageRefreshTimer);
          const pageId = activePageId;
          void sendPageWidgets?.(pageId).catch(() => undefined);
          pageRefreshTimer = setInterval(() => void sendPageWidgets?.(pageId).catch(() => undefined), 10_000);
          return;
        }
        if (message.type === "page-goodbye" && typeof message.pageId === "string"
          && normalizePageName(message.pageId) === activePageId) {
          activePageId = undefined;
          if (pageRefreshTimer) clearInterval(pageRefreshTimer);
          pageRefreshTimer = undefined;
          return;
        }
        if (connectedUserId && connectedSessionId && activityConnection && handleActivityMessage(
          connectedUserId,
          connectedSessionId,
          activityConnection,
          message,
        )) return;
        if (message.type === "activity:subscribe" || message.type === "activity:refresh") {
          void (ws as typeof ws & { data?: { sendSnapshot: () => Promise<void> } }).data?.sendSnapshot();
        }
      } catch {
        // Ignore unsupported client activity messages.
      }
    },
    onClose() {
      cleanup();
    },
  };
}));

export default activityRoute;
