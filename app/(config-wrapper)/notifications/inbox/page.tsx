"use client";

import React, { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import readEndpoint from "@/lib/frontend/data/GET/readEndpoint";
import { postNotificationsMarkAsRead } from "@/lib/apiClient";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";

export type NotificationItem = {
  id: string;
  content: any;
  status: string;
  created: string;
  topicId: string;
  topicName: string;
  title?: string;
  description?: string;
};

export default function NotificationsInboxPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const ctl = new AbortController();

    (async () => {
      try {
        const [notResp, topicResp] = await Promise.all([
          readEndpoint<{ items: any[] }>("/notifications", { signal: ctl.signal }),
          readEndpoint<{ items: any[] }>("/notifications/topics", { signal: ctl.signal }),
        ]);

        if (!mounted) return;
        setNotifications(notResp?.items || []);
        setTopics(topicResp?.items || []);
      } catch (err) {
        console.error("Notifications/topics fetch failed:", err);
      }
    })();

    return () => { mounted = false; ctl.abort(); };
  }, []);

  const markAsRead = async (notifId: string) => {
    const token = localStorage.getItem("pb_token");
    if (!token) return;
    try {
      await postNotificationsMarkAsRead({ id: notifId }, { token });
      setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n)));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  // Filter notifications by active topic; null shows all
  const filteredNotifications = activeTopic
    ? notifications.filter((n) => n.topicId === activeTopic)
    : notifications;

  if (!notifications.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <h2 className="text-xl font-semibold mb-2">No notifications</h2>
        <p className="text-center">You're all caught up!</p>
      </div>
    );
  }
  const hasUnread = notifications.some((n) => n.status !== "read");

  const markAllAsRead = async () => {
    const token = localStorage.getItem("pb_token");
    if (!token) return;
    try {
      await postNotificationsMarkAsRead(undefined, { token });
      setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
      }
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold">Inbox</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            markAllAsRead();
          }}
          disabled={!hasUnread}
          aria-label="Mark all notifications as read"
          className="ml-2"
        >
          Mark all as read
        </Button>
      </div>
      <div className="space-y-4">
        {/* --- Topic Chips (including “All”) --- */}
        <div className="flex gap-2 overflow-x-auto mb-4">
          {/* All notifications chip */}
          <button
            key="all"
            onClick={() => setActiveTopic(null)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap",
              activeTopic === null
                ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
                : "bg-white/10 text-gray-100 hover:bg-white/20"
            )}
          >
            All
          </button>

          {/* Individual topic chips */}
          {topics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => setActiveTopic(topic.id)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap",
                activeTopic === topic.id
                  ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
                  : "bg-white/10 text-gray-100 hover:bg-white/20"
              )}
            >
              {topic.title}
            </button>
          ))}
        </div>

        {/* --- Notifications --- */}
        {filteredNotifications.map((notif) => {
          const createdDate = new Date(notif.created).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          const contentTitle =
            notif.title ||
            (notif.content &&
              typeof notif.content === "object" &&
              "title" in notif.content
              ? String((notif.content as { title?: string }).title || "")
              : String(JSON.stringify(notif.content)));

          const contentDesc: React.ReactNode =
            notif.description ||
            (() => {
              // try object.description
              if (notif.content && typeof notif.content === "object" && "description" in notif.content) {
                return String((notif.content as { description?: string }).description);
              }

              // choose string to parse: prefer notif.content (if string) else fallback to notif.message
              const msg = typeof notif.content === "string" ? notif.content : (notif.content.message as string | undefined);
              if (!msg) return undefined;

              // split on newlines and render each line. If a line is "Key: Value", render with key styling.
              const lines = msg.split(/\r?\n/).filter((l) => l.trim().length > 0);
              if (lines.length === 1) return lines[0];

              return (
                <div className="flex flex-col gap-1">
                  {lines.map((line, i) => {
                    const idx = line.indexOf(":");
                    if (idx > 0) {
                      const key = line.slice(0, idx).trim();
                      const val = line.slice(idx + 1).trim();
                      return (
                        <div key={i}>
                          <span className="font-medium">{key}:</span> {val}
                        </div>
                      );
                    }
                    return <div key={i}>{line}</div>;
                  })}
                </div>
              );
            })();

          return (
            <div
              key={notif.id}
              onClick={() => markAsRead(notif.id)}
              className="frosted p-4 rounded-xl border border-white/20 backdrop-blur-md flex justify-between items-start shadow-lg group"
            >
              <div className="flex flex-col gap-1 w-full">
                <div className="notification-header flex justify-between w-full">
                  <div className="text-sm font-semibold">{notif.topicName}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {createdDate}
                  </div>
                </div>
                {contentTitle && (
                  <div
                    className={cn(
                      "text-base",
                      notif.status !== "read" ? "font-bold" : "font-semibold",
                      "group-hover:text-(--primary)"
                    )}
                  >
                    {contentTitle}
                  </div>
                )}
                {contentDesc && (
                  <div className="text-sm text-foreground">{contentDesc}</div>
                )}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-2">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="frosted text-foreground">
                  <DropdownMenuLabel className="font-semibold">Actions</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigator.clipboard.writeText(notif.id)}
                  >
                    Copy notification Id
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => alert(`Notification: ${JSON.stringify(notif)}`)}
                  >
                    Show notification JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => alert(`Topic ID: ${notif.topicId}`)}
                  >
                    Show topic Id
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
    </>
  );
}
