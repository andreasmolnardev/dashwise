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

export type NotificationItem = {
  id: string;
  content: string;
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
    const token = localStorage.getItem("pb_token");
    if (!token) return;

    // Fetch notifications
    fetch("/api/v1/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((json) => setNotifications(json.items || []))
      .catch(console.error);

    // Fetch topics
    fetch("/api/v1/notifications/topics", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setTopics(data.items || []);
        if (data.items?.length) setActiveTopic(data.items[0].id); // default active
      })
      .catch(console.error);
  }, []);

  const markAsRead = async (notifId: string) => {
    const token = localStorage.getItem("pb_token");
    if (!token) return;
    try {
      await fetch("/api/v1/notifications/markAsRead", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: notifId }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n))
      );
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

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Inbox</h1>
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

          const contentDesc =
            notif.description ||
            (notif.content &&
              typeof notif.content === "object" &&
              "description" in notif.content
              ? String((notif.content as { description?: string }).description)
              : undefined);

          return (
            <div
              key={notif.id}
              onClick={() => markAsRead(notif.id)}
              className="frosted p-4 rounded-xl border border-white/20 backdrop-blur-md flex justify-between items-start shadow-lg group"
            >
              <div className="flex flex-col gap-1 w-full">
                <div className="notification-header flex justify-between w-full">
                  <div className="text-sm font-semibold">{notif.topicName}</div>
                  <div className="text-xs text-(--text-secondary) mt-1">
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
                  <div className="text-sm text-(--text-primary)">{contentDesc}</div>
                )}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-2">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="frosted">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigator.clipboard.writeText(notif.id)}
                  >
                    Copy notification ID
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => alert(`Topic ID: ${notif.topicId}`)}
                  >
                    Show topic ID
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
