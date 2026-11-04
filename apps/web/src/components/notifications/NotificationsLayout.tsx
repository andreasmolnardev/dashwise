"use client";

import type { ReactNode } from "react";
import AppTemplate, { Content, Sidebar, Tab } from "@/components/apps/LayoutTemplate";

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return (
    <AppTemplate title="Notifications">
      <Sidebar>
        <Tab
          dst="/apps/notifications"
          icon="fa6-solid:bell"
          title="Inbox"
          isRoot
        />
      </Sidebar>
      <Content>{children}</Content>
    </AppTemplate>
  );
}
