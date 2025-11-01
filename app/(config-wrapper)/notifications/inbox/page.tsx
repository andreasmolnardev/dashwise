"use client"

import React, { useState, useEffect } from "react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"

export type NotificationItem = {
  id: string
  content: string
  status: string
  created: string
  topicId: string
  topicName: string
  title?: string
  description?: string
}

export default function NofticationsInboxPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  useEffect(() => {
    const token = localStorage.getItem("pb_token")
    if (!token) return

    fetch("/api/v1/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((json) => json.items ? setNotifications(json.items): setNotifications([]))
      .catch(console.error)
  }, [])

  if (!notifications || !notifications.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <h2 className="text-xl font-semibold mb-2">No notifications</h2>
        <p className="text-center">You're all caught up!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {notifications.map((notif) => {
        const createdDate = new Date(notif.created).toLocaleString("default", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })

        const contentTitle = notif.title || (typeof notif.content === "string" ? notif.content : notif?.content?.title)
        const contentDesc = notif.description || (typeof notif.content === "object" && notif?.content?.description)

        return (
          <div
            key={notif.id}
            className="frosted p-4 rounded-xl border border-white/20 backdrop-blur-md flex justify-between items-start shadow-lg"
          >
            <div className="flex flex-col gap-1 max-w-[80%]">
              <div className="text-sm font-semibold">{notif.topicName}</div>
              {contentTitle && <div className="text-base font-medium">{contentTitle}</div>}
              {contentDesc && <div className="text-sm text-muted-foreground">{contentDesc}</div>}
              <div className="text-xs text-muted-foreground mt-1">{createdDate}</div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="p-2">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="frosted">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(notif.id)}>
                  Copy notification ID
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => alert(`Topic ID: ${notif.topicId}`)}>
                  Show topic ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}
