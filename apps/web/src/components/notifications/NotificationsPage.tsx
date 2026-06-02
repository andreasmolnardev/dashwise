"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";
import {
    createNotificationTopicAction,
    deleteNotificationTopicAction,
    getNotificationsAction,
    getNotificationTopicsAction,
    markNotificationsAsReadAction,
} from "@/app/actions/notifications/items";
import { getForwardersAction } from "@/app/actions/notifications/forwarders";
import { listTopicTokensAction } from "@/app/actions/notifications/topicTokens";
import CreateForwarderDialogComponent from "@/components/notifications/CreateForwarderDialog";
import CreateTopicTokenDialogComponent from "@/components/notifications/CreateTopicTokenDialog";
import useAuth from "@/context/useAuth";

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

type TopicItem = { id: string; title: string };
type TopicTokenItem = {
    id: string;
    token?: string;
    topic?: { id: string; title?: string } | string;
    expires?: string | null;
    created?: string | null;
};
type TopicForwarderItem = {
    id: string;
    topic?: { id: string } | string;
    target?: string;
    isActive?: boolean;
    created?: string | null;
    updated?: string | null;
};

export default function NotificationsPage() {
    const { token, withAuth } = useAuth();
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [topics, setTopics] = useState<TopicItem[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [createTopicOpen, setCreateTopicOpen] = useState(false);
    const [createTopicTitle, setCreateTopicTitle] = useState("");
    const [creatingTopic, setCreatingTopic] = useState(false);
    const [topicForToken, setTopicForToken] = useState<TopicItem | null>(null);
    const [topicForForwarder, setTopicForForwarder] = useState<
        TopicItem | null
    >(null);
    const [topicToDelete, setTopicToDelete] = useState<TopicItem | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [topicDetailsOpen, setTopicDetailsOpen] = useState(false);
    const [topicDetailsTopic, setTopicDetailsTopic] = useState<TopicItem | null>(
        null
    );
    const [topicDetailsTokens, setTopicDetailsTokens] = useState<
        TopicTokenItem[]
    >([]);
    const [topicDetailsForwarders, setTopicDetailsForwarders] = useState<
        TopicForwarderItem[]
    >([]);
    const [topicDetailsLoading, setTopicDetailsLoading] = useState(false);
    const [topicDetailsSection, setTopicDetailsSection] = useState<
        "tokens" | "forwarders" | null
    >(null);
    const tokensSectionRef = useRef<HTMLDivElement | null>(null);
    const forwardersSectionRef = useRef<HTMLDivElement | null>(null);

    const fetchData = useCallback(async () => {
        if (!token) return;

        try {
            const [notResp, topicResp] = await withAuth((auth) =>
                Promise.all([
                    getNotificationsAction(auth),
                    getNotificationTopicsAction(auth),
                ])
            );

            const nextNotifications = notResp?.items || [];
            const nextTopics = topicResp?.items || [];

            setNotifications(nextNotifications);
            setTopics(nextTopics);
            setActiveTopic((current) =>
                current && !nextTopics.some((topic) => topic.id === current)
                    ? null
                    : current
            );
        } catch (err) {
            console.error("Notifications/topics fetch failed:", err);
        }
    }, [token, withAuth]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const fetchTopicDetails = useCallback(async () => {
        if (!token || !topicDetailsTopic) return;

        setTopicDetailsLoading(true);
        try {
            const [tokensResp, forwardersResp] = await withAuth((auth) =>
                Promise.all([
                    listTopicTokensAction(auth),
                    getForwardersAction(auth),
                ])
            );

            const tokens = (tokensResp?.items || []).filter(
                (item: TopicTokenItem) => {
                    const topicId =
                        typeof item.topic === "string"
                            ? item.topic
                            : item.topic?.id;
                    return topicId === topicDetailsTopic.id;
                }
            );
            const forwarders = (forwardersResp?.items || []).filter(
                (item: TopicForwarderItem) => {
                    const topicId =
                        typeof item.topic === "string"
                            ? item.topic
                            : item.topic?.id;
                    return topicId === topicDetailsTopic.id;
                }
            );

            setTopicDetailsTokens(tokens);
            setTopicDetailsForwarders(forwarders);
        } catch (err) {
            console.error("Failed to load topic details:", err);
        } finally {
            setTopicDetailsLoading(false);
        }
    }, [token, withAuth, topicDetailsTopic]);

    useEffect(() => {
        if (!topicDetailsOpen || !topicDetailsTopic) return;
        fetchTopicDetails();
    }, [fetchTopicDetails, topicDetailsOpen, topicDetailsTopic]);

    useEffect(() => {
        if (!topicDetailsOpen || !topicDetailsSection) return;
        const target =
            topicDetailsSection === "tokens"
                ? tokensSectionRef.current
                : forwardersSectionRef.current;
        if (!target) return;

        const rafId = requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        });

        return () => cancelAnimationFrame(rafId);
    }, [
        topicDetailsOpen,
        topicDetailsSection,
        topicDetailsTokens.length,
        topicDetailsForwarders.length,
    ]);

    const hasUnread = useMemo(
        () =>
            notifications.some((notification) =>
                notification.status !== "read"
            ),
        [notifications],
    );
    const unreadCount = useMemo(
        () =>
            notifications.filter((notification) =>
                notification.status !== "read"
            ).length,
        [notifications],
    );

    const filteredNotifications = activeTopic
        ? notifications.filter((notification) =>
            notification.topicId === activeTopic
        )
        : notifications;

    const markAsRead = async (notifId: string) => {
        if (!token) return;
        try {
            await withAuth((auth) =>
                markNotificationsAsReadAction(auth, [notifId])
            );
            setNotifications((prev) =>
                prev.map((notification) =>
                    notification.id === notifId
                        ? { ...notification, status: "read" }
                        : notification
                )
            );
            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
            }
        } catch (err) {
            console.error("Failed to mark notification as read:", err);
        }
    };

    const markAllAsRead = async () => {
        if (!token) return;
        try {
            await withAuth((auth) => markNotificationsAsReadAction(auth, []));
            setNotifications((prev) =>
                prev.map((notification) => ({
                    ...notification,
                    status: "read",
                }))
            );
            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
            }
        } catch (err) {
            console.error("Failed to mark all notifications as read:", err);
        }
    };

    const createTopic = async () => {
        const title = createTopicTitle.trim();
        if (!title || !token) return;

        setCreatingTopic(true);
        try {
            const result = await withAuth((auth) =>
                createNotificationTopicAction(auth, title)
            );
            setCreateTopicTitle("");
            setCreateTopicOpen(false);
            await fetchData();
            if (result?.topicId) {
                setActiveTopic(result.topicId);
            }
        } catch (err) {
            console.error("Failed to create topic:", err);
            alert("Failed to create topic");
        } finally {
            setCreatingTopic(false);
        }
    };

    const deleteTopic = async (topic: TopicItem) => {
        if (!token) return;
        const confirmed = window.confirm(
            `Delete topic \"${topic.title}\" and all attached messages, tokens, and forwarders?`,
        );
        if (!confirmed) return;

        try {
            await withAuth((auth) =>
                deleteNotificationTopicAction(auth, topic.id)
            );
            setTopicToDelete(null);
            if (activeTopic === topic.id) {
                setActiveTopic(null);
            }
            await fetchData();
        } catch (err) {
            console.error("Failed to delete topic:", err);
            alert("Failed to delete topic");
        }
    };

    const topicForTokenItems = topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
    }));

    const openTopicDetails = (
        topic: TopicItem,
        section: "tokens" | "forwarders"
    ) => {
        setTopicDetailsTopic(topic);
        setTopicDetailsSection(section);
        setTopicDetailsTokens([]);
        setTopicDetailsForwarders([]);
        setTopicDetailsOpen(true);
    };

    return (
        <>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-semibold">Notifications</h1>
                    {hasUnread && (
                        <div className="flex items-center shrink-0">
                            <div
                                className="h-8 inline-flex items-center rounded-l-xl rounded-r-sm border border-primary/60 bg-white/15 px-3 text-sm font-semibold text-white backdrop-blur-md"
                                aria-label={`${unreadCount} unread notifications`}
                            >
                                {unreadCount}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    markAllAsRead();
                                }}
                                className="h-8 w-8 rounded-l-sm rounded-r-xl border border-l-0 border-primary/60 bg-white/10 p-0 hover:bg-white/20"
                                aria-label="Mark all notifications as read"
                                title="Mark all as read"
                            >
                                <Check className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHelpOpen(true)}
                        className="gap-2 text-muted-foreground hover:text-foreground"
                    >
                        How to use?
                    </Button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex gap-2 overflow-x-auto mb-4 items-center">
                    <button
                        key="all"
                        onClick={() => setActiveTopic(null)}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap",
                            activeTopic === null
                                ? "bg-white/20 backdrop-blur-md text-white border border-primary"
                                : "bg-white/10 text-gray-100 hover:bg-white/20",
                        )}
                    >
                        All
                    </button>

                    {topics.map((topic) => (
                        <div
                            key={topic.id}
                            className="flex items-center gap-1 shrink-0"
                        >
                            <button
                                onClick={() => setActiveTopic(topic.id)}
                                className={cn(
                                    "px-4 py-2 rounded-l-xl rounded-r-sm text-sm font-medium transition whitespace-nowrap",
                                    activeTopic === topic.id
                                        ? "bg-white/20 backdrop-blur-md text-white border border-primary"
                                        : "bg-white/10 text-gray-100 hover:bg-white/20",
                                )}
                            >
                                {topic.title}
                            </button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 w-9 rounded-r-xl rounded-l-sm bg-white/10 hover:bg-white/20"
                                    >
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="start"
                                    className="frosted text-foreground"
                                >
                                    <DropdownMenuLabel className="font-semibold">
                                        Topic actions
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem
                                        onClick={() =>
                                            openTopicDetails(topic, "tokens")}
                                    >
                                        View topic tokens
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() =>
                                            openTopicDetails(
                                                topic,
                                                "forwarders",
                                            )}
                                    >
                                        View topic forwarders
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => setTopicForToken(topic)}
                                    >
                                        New topic token
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() =>
                                            setTopicForForwarder(topic)}
                                    >
                                        New topic forwarder
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-red-300 focus:text-red-200"
                                        onClick={() => setTopicToDelete(topic)}
                                    >
                                        Delete topic and messages
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ))}

                    <span className="w-full"></span>

                    <Button
                        variant="ghost"
                        onClick={() => setCreateTopicOpen(true)}
                        className="gap-2 frosted-lite hover:text-primary"
                    >
                        <Plus className="h-4 w-4" />
                        Topic
                    </Button>
                </div>

                {filteredNotifications.length === 0
                    ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <h2 className="text-xl font-semibold mb-2">
                                No notifications
                            </h2>
                            <p className="text-center">
                                {activeTopic
                                    ? "No messages for this topic yet."
                                    : "You're all caught up!"}
                            </p>
                        </div>
                    )
                    : (
                        filteredNotifications.map((notif) => {
                            const createdDate = new Date(notif.created)
                                .toLocaleString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                });

                            const contentTitle = notif.title ||
                                (notif.content &&
                                        typeof notif.content === "object" &&
                                        "title" in notif.content
                                    ? String(
                                        (notif.content as { title?: string })
                                            .title || "",
                                    )
                                    : String(JSON.stringify(notif.content)));

                            const contentDesc: React.ReactNode =
                                notif.description ||
                                (() => {
                                    if (
                                        notif.content &&
                                        typeof notif.content === "object" &&
                                        "description" in notif.content
                                    ) {
                                        return String(
                                            (notif.content as {
                                                description?: string;
                                            }).description,
                                        );
                                    }

                                    const msg =
                                        typeof notif.content === "string"
                                            ? notif.content
                                            : (notif.content.message as
                                                | string
                                                | undefined);
                                    if (!msg) return undefined;

                                    const lines = msg.split(/\r?\n/).filter((
                                        line,
                                    ) => line.trim().length > 0);
                                    if (lines.length === 1) return lines[0];

                                    return (
                                        <div className="flex flex-col gap-1">
                                            {lines.map((line, index) => {
                                                const dividerIndex = line
                                                    .indexOf(":");
                                                if (dividerIndex > 0) {
                                                    const key = line.slice(
                                                        0,
                                                        dividerIndex,
                                                    ).trim();
                                                    const value = line.slice(
                                                        dividerIndex + 1,
                                                    ).trim();
                                                    return (
                                                        <div key={index}>
                                                            <span className="font-medium">
                                                                {key}:
                                                            </span>{" "}
                                                            {value}
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div key={index}>
                                                        {line}
                                                    </div>
                                                );
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
                                            <div className="text-sm font-semibold">
                                                {notif.topicName}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {createdDate}
                                            </div>
                                        </div>
                                        {contentTitle && (
                                            <div
                                                className={cn(
                                                    "text-base",
                                                    notif.status !== "read"
                                                        ? "font-bold"
                                                        : "font-semibold",
                                                    "group-hover:text-primary",
                                                )}
                                            >
                                                {notif.status !== "read" && (
                                                    <span className="inline-block w-2 h-2 bg-primary rounded-full mr-2">
                                                    </span>
                                                )}
                                                {contentTitle}
                                            </div>
                                        )}
                                        {contentDesc && (
                                            <div className="text-sm text-foreground">
                                                {contentDesc}
                                            </div>
                                        )}
                                    </div>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="p-2"
                                            >
                                                <MoreHorizontal />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            className="frosted text-foreground"
                                        >
                                            <DropdownMenuLabel className="font-semibold">
                                                Actions
                                            </DropdownMenuLabel>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    navigator.clipboard
                                                        .writeText(notif.id)}
                                            >
                                                Copy notification Id
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    alert(
                                                        `Notification: ${
                                                            JSON.stringify(
                                                                notif,
                                                            )
                                                        }`,
                                                    )}
                                            >
                                                Show notification JSON
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    alert(
                                                        `Topic ID: ${notif.topicId}`,
                                                    )}
                                            >
                                                Show topic Id
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            );
                        })
                    )}
            </div>

            <Dialog open={createTopicOpen} onOpenChange={setCreateTopicOpen}>
                <DialogContent className="frosted text-foreground">
                    <DialogHeader>
                        <DialogTitle>New Topic</DialogTitle>
                        <DialogDescription>
                            Create a topic name to group related notifications.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            Topic title
                        </label>
                        <Input
                            value={createTopicTitle}
                            onChange={(event) =>
                                setCreateTopicTitle(event.target.value)}
                            placeholder="e.g. Home Lab, Alerts, Releases"
                            autoFocus
                        />
                    </div>

                    <DialogFooter className="mt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setCreateTopicOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={createTopic}
                            disabled={!createTopicTitle.trim() || creatingTopic}
                        >
                            {creatingTopic ? "Creating..." : "Create topic"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                            "}`}
                            </pre>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={topicDetailsOpen}
                onOpenChange={(open) => {
                    setTopicDetailsOpen(open);
                    if (!open) {
                        setTopicDetailsTopic(null);
                        setTopicDetailsSection(null);
                    }
                }}
            >
                <DialogContent className="frosted text-foreground max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Topic details</DialogTitle>
                    </DialogHeader>

                    {topicDetailsLoading ? (
                        <div className="py-6 text-sm text-muted-foreground">
                            Loading topic details...
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div ref={tokensSectionRef} className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold">
                                        Topic tokens
                                    </h3>
                                </div>

                                {topicDetailsTokens.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No active tokens for this topic.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {topicDetailsTokens.map((item) => (
                                            <div
                                                key={item.id}
                                                className="rounded-lg border border-white/10 bg-white/5 p-3"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="text-xs text-muted-foreground">
                                                            Token
                                                        </div>
                                                        <div className="font-mono text-xs break-all text-white/90">
                                                            {item.token ||
                                                                "(hidden)"}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            item.token &&
                                                            navigator.clipboard
                                                                .writeText(
                                                                    item
                                                                        .token,
                                                                )}
                                                    >
                                                        Copy
                                                    </Button>
                                                </div>
                                                <div className="mt-2 text-xs text-muted-foreground">
                                                    {item.expires
                                                        ? `Expires ${new Date(
                                                            item.expires,
                                                        ).toLocaleString()}`
                                                        : "No expiry"}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div
                                ref={forwardersSectionRef}
                                className="space-y-3"
                            >
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold">
                                        Forwarders
                                    </h3>
                                </div>

                                {topicDetailsForwarders.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No forwarders configured for this
                                        topic.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {topicDetailsForwarders.map((item) => (
                                            <div
                                                key={item.id}
                                                className="rounded-lg border border-white/10 bg-white/5 p-3"
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="text-sm text-white/90 break-all">
                                                        {item.target ||
                                                            "(missing target)"}
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            "rounded-full px-2 py-1 text-xs font-semibold",
                                                            item.isActive
                                                                ? "bg-emerald-500/20 text-emerald-100"
                                                                : "bg-amber-500/20 text-amber-100",
                                                        )}
                                                    >
                                                        {item.isActive
                                                            ? "Active"
                                                            : "Paused"}
                                                    </span>
                                                </div>
                                                {item.updated && (
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        Updated{" "}
                                                        {new Date(
                                                            item.updated,
                                                        ).toLocaleString()}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setTopicDetailsOpen(false)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <CreateTopicTokenDialogComponent
                open={Boolean(topicForToken)}
                onOpenChange={(open) => {
                    if (!open) setTopicForToken(null);
                }}
                topics={topicForTokenItems}
                initialTopic={topicForToken}
            />

            <CreateForwarderDialogComponent
                open={Boolean(topicForForwarder)}
                onOpenChange={(open) => {
                    if (!open) setTopicForForwarder(null);
                }}
                topics={topicForTokenItems}
                initialTopic={topicForForwarder}
            />

            <Dialog
                open={Boolean(topicToDelete)}
                onOpenChange={(open) => {
                    if (!open) setTopicToDelete(null);
                }}
            >
                <DialogContent className="frosted text-foreground">
                    <DialogHeader>
                        <DialogTitle>Delete topic</DialogTitle>
                        <DialogDescription>
                            {topicToDelete
                                ? `This will permanently delete \"${topicToDelete.title}\" and all messages, tokens, and forwarders attached to it.`
                                : "This will permanently delete the topic and all attached records."}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setTopicToDelete(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() =>
                                topicToDelete && deleteTopic(topicToDelete)}
                            disabled={!topicToDelete}
                        >
                            Delete topic
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
