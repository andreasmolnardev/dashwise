"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import useAuth from "@/context/useAuth";
import { backendUrl } from "@/lib/apiClient";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";
import { getClientSessionId } from "@/lib/session";
import { executeRegisteredActivityShortcut } from "@/lib/activityShortcuts";

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
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<ActivityCalendarEvent[]>([]);

  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setCalendarEvents([]);
      queryClient.removeQueries({ queryKey: ["api", token, ...queryKeys.notifications.items(null)] });
      return;
    }

    let closed = false;
    const connect = () => {
      const nextSocket = new WebSocket(socketUrl(token, sessionId));
      socket.current = nextSocket;
      nextSocket.onopen = () => nextSocket.send(JSON.stringify({ type: "activity:subscribe" }));
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
          if (message.type !== "activity:snapshot") return;
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
      socket.current?.close();
      socket.current = null;
    };
  }, [queryClient, sessionId, token]);

  const refresh = () => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "activity:refresh" }));
    }
  };

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
  return <ActivityContext.Provider value={{ notifications, unreadCount, calendarEvents, refresh, markNotificationsAsRead }}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used inside ActivityProvider");
  return context;
}
