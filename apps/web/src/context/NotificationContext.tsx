"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify-icon/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type NotificationVariant = "success" | "error";

export type NotificationOptions = {
  title: string;
  description?: string;
  variant?: NotificationVariant;
  duration?: number;
};

type Notification = NotificationOptions & {
  id: string;
};

type NotificationContextValue = {
  notify: (options: NotificationOptions) => string;
  dismiss: (id: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const defaultDuration = 5000;
const maxNotifications = 4;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationId = useRef(0);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const notify = useCallback((options: NotificationOptions) => {
    const id = `${Date.now()}-${notificationId.current++}`;
    const notification = { ...options, id };
    setNotifications((current) => [...current, notification].slice(-maxNotifications));

    if (options.duration !== 0) {
      const duration = options.duration ?? defaultDuration;
      timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    }

    return id;
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col items-end gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {notifications.map((notification) => (
          <Alert
            key={notification.id}
            variant={notification.variant === "error" ? "destructive" : "default"}
            className="frosted pointer-events-auto flex items-start gap-3 text-(--text-on-frosted) origin-bottom-right animate-in fade-in slide-in-from-bottom-4 slide-in-from-right-4 duration-300"
          >
            <Icon
              icon={notification.variant === "error" ? "fa6-solid:triangle-exclamation" : "fa6-solid:circle-check"}
              className="mt-0.5 size-4 shrink-0 text-(--text-on-frosted)"
            />
            <div className="min-w-0 flex-1 pr-6">
              <AlertTitle className="text-(--text-on-frosted)">{notification.title}</AlertTitle>
              {notification.description && (
                <AlertDescription className="text-(--text-on-frosted)">{notification.description}</AlertDescription>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(notification.id)}
              className="absolute right-2 top-2 rounded p-1 text-current/70 transition-colors hover:bg-white/10 hover:text-current"
            >
              <Icon icon="fa6-solid:xmark" />
            </button>
          </Alert>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotification must be used inside NotificationProvider");
  return context;
}
