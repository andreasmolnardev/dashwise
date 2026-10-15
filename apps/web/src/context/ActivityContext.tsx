"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import { backendUrl } from "@/lib/apiClient";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";
import { getClientSessionId } from "@/lib/session";
import { executeRegisteredActivityShortcut } from "@/lib/activityShortcuts";
import { SdkResourceSubscriptions, type SdkResourceIdentity, type SdkResourceRevision } from "@/lib/sdkResourceSubscriptions";

export type { SdkResourceIdentity, SdkResourceRevision } from "@/lib/sdkResourceSubscriptions";

export type ActivityNotification = {
  id: string;
  content: unknown;
  status: string;
  created: string;
  topicId: string | null;
  topicName: string | null;
};

export type ActivityCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  isAllDay?: boolean;
};

type ActivityContextValue = {
  notifications: ActivityNotification[];
  unreadCount: number;
  calendarEvents: ActivityCalendarEvent[];
  refresh: () => void;
  markNotificationsAsRead: (ids: string[]) => void;
  subscribeSdkResources: (
    resources: readonly SdkResourceIdentity[],
    listener: (event: SdkResourceRevision) => void,
  ) => () => void;
  subscribePageWidgets: (pageId: string, listener: (item: Record<string, unknown>) => void) => () => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

function socketUrl(token: string, sessionId: string | null) {
  const url = new URL(backendUrl("api/v1/activity"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const sessionId = getClientSessionId();
  const queryClient = useQueryClient();
  const socket = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const sdkResourceSubscriptions = useRef(new SdkResourceSubscriptions());
  const pageWidgetSubscriptions = useRef(new Map<string, Set<(item: Record<string, unknown>) => void>>());
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<ActivityCalendarEvent[]>([]);

  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setCalendarEvents([]);
      sdkResourceSubscriptions.current.clear();
      queryClient.removeQueries({ queryKey: ["api", token, ...queryKeys.notifications.items(null)] });
      return;
    }

    let closed = false;
    const connect = () => {
      const nextSocket = new WebSocket(socketUrl(token, sessionId));
      socket.current = nextSocket;
      nextSocket.onopen = () => {
        if (closed) {
          nextSocket.close();
          return;
        }
        nextSocket.send(JSON.stringify({ type: "activity:subscribe" }));
        const resources = sdkResourceSubscriptions.current.resources();
        if (resources.length > 0) {
          nextSocket.send(JSON.stringify({ type: "sdk:resources:subscribe", resources }));
        }
        for (const pageId of pageWidgetSubscriptions.current.keys()) {
          nextSocket.send(JSON.stringify({ type: "page-hello", pageId }));
        }
      };
      nextSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "shortcut:execute" && typeof message.requestId === "string" && typeof message.shortcutId === "string") {
            void executeRegisteredActivityShortcut(message.shortcutId).then((result) => {
              if (nextSocket.readyState !== WebSocket.OPEN) return;
              nextSocket.send(JSON.stringify({
                type: "shortcut:result",
                requestId: message.requestId,
                success: result.success,
                ...(result.error ? { error: result.error } : {}),
              }));
            });
            return;
          }
          if (message.type === "activities:changed") {
            void queryClient.invalidateQueries({ queryKey: ["api", token, ...queryKeys.activities.root] });
            return;
          }
          if (
            message.type === "sdk:resource-revision"
            && typeof message.instanceId === "string"
            && typeof message.collectionId === "string"
            && typeof message.resourceId === "string"
            && typeof message.revision === "number"
            && (message.operation === "upsert" || message.operation === "remove")
          ) {
            const revision = message as SdkResourceRevision;
            sdkResourceSubscriptions.current.dispatch(revision);
            return;
          }
          if (message.type === "page-widget" && typeof message.pageId === "string" && message.item && typeof message.item === "object") {
            for (const listener of pageWidgetSubscriptions.current.get(message.pageId) ?? []) {
              listener(message.item as Record<string, unknown>);
            }
            return;
          }
          if (message.type !== "activity:snapshot") return;
          void queryClient.invalidateQueries({ queryKey: ["api", token, ...queryKeys.activities.root] });
           const nextNotifications = Array.isArray(message.notifications) ? message.notifications : [];
           setNotifications(nextNotifications);
           queryClient.setQueryData(["api", token, ...queryKeys.notifications.items(token)], nextNotifications);
           setCalendarEvents(Array.isArray(message.calendarEvents) ? message.calendarEvents : []);
        } catch {
          // Ignore malformed activity messages and retain last known state.
        }
      };
      nextSocket.onclose = () => {
        if (!closed) reconnectTimer.current = window.setTimeout(connect, 3_000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      const currentSocket = socket.current;
      if (currentSocket?.readyState === WebSocket.CONNECTING) {
        currentSocket.onopen = () => currentSocket.close();
        currentSocket.onmessage = null;
        currentSocket.onerror = null;
        currentSocket.onclose = null;
      } else {
        currentSocket?.close();
      }
      socket.current = null;
    };
  }, [queryClient, sessionId, token]);

  const refresh = () => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "activity:refresh" }));
    }
  };

  const subscribeSdkResources = useCallback((
    resources: readonly SdkResourceIdentity[],
    listener: (event: SdkResourceRevision) => void,
  ) => {
    const subscription = sdkResourceSubscriptions.current.subscribe(resources, listener);
    if (socket.current?.readyState === WebSocket.OPEN && subscription.added.length > 0) {
      socket.current.send(JSON.stringify({ type: "sdk:resources:subscribe", resources: subscription.added }));
    }

    return () => {
      const removed = subscription.unsubscribe();
      if (socket.current?.readyState === WebSocket.OPEN && removed.length > 0) {
        socket.current.send(JSON.stringify({ type: "sdk:resources:unsubscribe", resources: removed }));
      }
    };
  }, []);

  const subscribePageWidgets = useCallback((pageId: string, listener: (item: Record<string, unknown>) => void) => {
    const listeners = pageWidgetSubscriptions.current.get(pageId) ?? new Set();
    listeners.add(listener);
    pageWidgetSubscriptions.current.set(pageId, listeners);
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "page-hello", pageId }));
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        pageWidgetSubscriptions.current.delete(pageId);
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: "page-goodbye", pageId }));
        }
      }
    };
  }, []);

  const markNotificationsAsRead = (ids: string[]) => {
    const markAsRead = (currentNotifications: ActivityNotification[]) =>
      currentNotifications.map((notification) =>
        ids.length === 0 || ids.includes(notification.id)
          ? { ...notification, status: "read" }
          : notification,
      );
    setNotifications(markAsRead);
    queryClient.setQueryData<ActivityNotification[]>(
      ["api", token, ...queryKeys.notifications.items(token)],
      (currentNotifications = []) => markAsRead(currentNotifications),
    );
  };

  const unreadCount = notifications.filter((notification) => notification.status !== "read").length;
  return <ActivityContext.Provider value={{ notifications, unreadCount, calendarEvents, refresh, markNotificationsAsRead, subscribeSdkResources, subscribePageWidgets }}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used inside ActivityProvider");
  return context;
}
