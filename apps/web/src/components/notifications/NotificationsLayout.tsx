"use client";
import { useCallback, useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { getNotificationsAction } from "@/app/actions/notifications/items";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";
import config from "@/lib/config";
import AppTemplate, { Sidebar, Tab, Content } from "@/components/apps/LayoutTemplate";

export default function NotificationsLayoutComponent({ children }: { children: React.ReactNode }) {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const { token, withAuth } = useAuth();

    const fetchUnreadCount = useCallback(async () => {
        if (!token) return;
        try {
            const data = await withAuth((auth) => getNotificationsAction(auth, false, true));
            setUnreadCount(data.unread || 0);
        } catch (err) {
            console.error(err);
        }
    }, [token, withAuth]);

    useEffect(() => {
        fetchUnreadCount();
    }, [config.app_base_url, fetchUnreadCount]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, fetchUnreadCount);
        return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, fetchUnreadCount);
    }, [fetchUnreadCount]);

    return (
        <AppTemplate title="Notifications">
            <Sidebar>
                <Tab
                    dst="/notifications/inbox"
                    group="inbox"
                    icon="fa6-solid:inbox"
                    title="Inbox"
                    badge={unreadCount > 0 ? unreadCount : undefined}
                />
                <Tab
                    dst="/notifications/forwarders"
                    group="forwarders"
                    icon="fa6-solid:share-nodes"
                    title="Forwarders"
                />
                <Tab
                    dst="/notifications/tokens"
                    icon="fa6-solid:key"
                    group="tokens"
                    title="Tokens"
                />
            </Sidebar>

            <Content>{children}</Content>
        </AppTemplate>
    );
}