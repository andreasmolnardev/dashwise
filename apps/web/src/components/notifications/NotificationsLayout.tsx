"use client";
import { useCallback, useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { getNotificationsAction } from "@/app/actions/notifications/items";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";
import config from "@/lib/config";
import AppTemplate, {
    Action,
    Content,
    Sidebar,
    Tab,
} from "@/components/apps/LayoutTemplate";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export default function NotificationsLayoutComponent(
    { children }: { children: React.ReactNode },
) {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [helpOpen, setHelpOpen] = useState(false);
    const { token, withAuth } = useAuth();

    const fetchUnreadCount = useCallback(async () => {
        if (!token) return;
        try {
            const data = await withAuth((auth) =>
                getNotificationsAction(auth, false, true)
            );
            setUnreadCount(data?.unread || 0);
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
        return () =>
            window.removeEventListener(
                NOTIFICATIONS_UPDATED_EVENT,
                fetchUnreadCount,
            );
    }, [fetchUnreadCount]);

    return (
        <>
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
                    <Action
                        icon="fa6-solid:circle-question"
                        title="How to use?"
                        action={() => setHelpOpen(true)}
                    />
                </Sidebar>

                <Content>{children}</Content>
            </AppTemplate>

            <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
                <DialogContent className="frosted text-foreground max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>How to send notifications</DialogTitle>
                        <DialogDescription>
                            Dashwise accepts any JSON payload at the
                            notifications endpoint. Use a topic token for
                            automation, and keep the token secret.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 text-sm leading-6 text-white/80 break-words">
                        <div className="space-y-1">
                            <p className="font-medium text-white">
                                1. Create a topic token
                            </p>
                            <p>
                                Generate a token in the Tokens tab and attach it
                                to the topic you want to receive notifications
                                for.
                            </p>
                        </div>

                        <div className="space-y-1">
                            <p className="font-medium text-white">
                                2. POST JSON to the notifications endpoint
                            </p>
                            <p>
                                Send your payload to{" "}
                                <span className="font-mono text-white break-all">
                                    /api/v1/notifications
                                </span>{" "}
                                with the token in the{" "}
                                <span className="font-mono text-white break-all">
                                    Authorization
                                </span>{" "}
                                header or as the{" "}
                                <span className="font-mono text-white break-all">
                                    ?token=
                                </span>{" "}
                                query parameter.
                            </p>

                            <pre className="whitespace-pre-wrap break-all overflow-x-hidden rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/90">
{`curl -X POST ${"${URL}"}/api/v1/notifications \\
  -H "Authorization: Bearer ${"${topicToken}"}" \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Backing up TV shows","details":"Backup completed"}'`}
                            </pre>
                        </div>

                        <div className="space-y-1">
                            <p className="font-medium text-white">
                                3. Use Shoutrrr for automation
                            </p>
                            <p>
                                Shoutrrr can call Dashwise directly. The docs
                                use a generic target with the same bearer token:
                            </p>

                            <pre className="whitespace-pre-wrap break-all overflow-x-hidden rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/90">
{`Expression: generic://${"${URL}"}/api/v1/notifications/${"${topicToken}"}?template=json
Headers: Authorization: Bearer ${"${topicToken}"}`}
                            </pre>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
