"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";
import EditFormComponent from "@/components/settings/EditForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SubscriptionDetailsForm from "@/components/news/SubscriptionDetailsForm";
import { Button } from "../ui/button";

type NewsFeed = {
    id?: string;
    feedUrl: string;
    name?: string;
    icon?: string;
    category?: string;
};

export default function ManageFeedsComponent() {
    const [feeds, setFeeds] = useState<NewsFeed[]>([]);
    const [loading, setLoading] = useState(true);

    // dialog state for subscription details form
    const [addOpen, setAddOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<NewsFeed | null>(null);
    const [addingGroup, setAddingGroup] = useState<string>("");
    const addOnAddedRef = useRef<((item: NewsFeed) => void) | null>(null);

    const categories = useMemo(() => {
        const s = new Set<string>();
        for (const f of feeds) {
            s.add((f.category ?? "Uncategorized").trim() || "Uncategorized");
        }
        return Array.from(s);
    }, [feeds]);

    const token =
        typeof window !== "undefined"
            ? localStorage.getItem("pb_token")
            : null;

    // Fetch feeds on mount
    useEffect(() => {
        const fetchFeeds = async () => {
            if (!token) {
                setLoading(false);
                return;
            }

            try {
                const res = await fetch("/api/v1/news", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (!res.ok) {
                    setLoading(false);
                    return;
                }

                const data = await res.json();
                const subscriptions = data.subscriptions || [];
                setFeeds(subscriptions);
            } catch (err) {
                console.error("Failed to fetch feeds:", err);
                setFeeds([]);
            } finally {
                setLoading(false);
            }
        };

        fetchFeeds();
    }, [token]);

    // Subscribe to a new feed
    const subscribeFeed = async (feed: NewsFeed) => {
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/v1/news/feed-subscribe", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                feedUrl: feed.feedUrl,
                name: feed.name || "",
                icon: feed.icon || "",
                category: feed.category || "",
            }),
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Failed to subscribe to feed");
        }

        // Refresh feeds list
        const refreshRes = await fetch("/api/v1/news", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (refreshRes.ok) {
            const data = await refreshRes.json();
            setFeeds(data.subscriptions || []);
        }
    };

    // Unsubscribe from a feed
    const unsubscribeFeed = async (feedUrl: string) => {
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/v1/news/feed-unsubscribe", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ feedUrl }),
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Failed to unsubscribe from feed");
        }

        // Refresh feeds list
        const refreshRes = await fetch("/api/v1/news", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (refreshRes.ok) {
            const data = await refreshRes.json();
            setFeeds(data.subscriptions || []);
        }
    };

    // Update an existing feed
    const updateFeed = async (oldFeedUrl: string, updatedFeed: NewsFeed) => {
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/v1/news/feed-update", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                oldFeedUrl,
                feedUrl: updatedFeed.feedUrl,
                name: updatedFeed.name || "",
                icon: updatedFeed.icon || "",
                category: updatedFeed.category || "",
            }),
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Failed to update feed");
        }

        // Refresh feeds list
        const refreshRes = await fetch("/api/v1/news", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (refreshRes.ok) {
            const data = await refreshRes.json();
            setFeeds(data.subscriptions || []);
        }
    };

    const handleGroupAction = async (action: "rename" | "delete", groupName: string, payload?: any) => {
        try {
            if (action === "rename") {
                const newCategory = payload?.newName || payload;
                if (!newCategory) return;

                const res = await fetch("/api/v1/news/feed-category-rename", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        oldCategory: groupName,
                        newCategory: newCategory,
                    }),
                });

                if (!res.ok) {
                    const json = await res.json();
                    throw new Error(json.error || "Failed to rename category");
                }

                // Refresh feeds list to reflect category change
                const refreshRes = await fetch("/api/v1/news", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (refreshRes.ok) {
                    const data = await refreshRes.json();
                    setFeeds(data.subscriptions || []);
                }
            } else if (action === "delete") {
                // Delete all feeds in this category
                const feedsInCategory = feeds.filter(f => (f.category || "Uncategorized") === groupName);
                for (const feed of feedsInCategory) {
                    await unsubscribeFeed(feed.feedUrl);
                }
            }
            console.log(action)
        } catch (err) {
            console.error("group action failed", err);
            window.alert(`Failed to perform group action: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    if (loading) {
        return <div className="text-center py-8">Loading feeds...</div>;
    }

    return (
        <main className="text-(--text-primary) p-4">
            <h1 className="text-2xl font-semibold mb-4">Manage Feeds</h1>

            <div className="content space-y-2">
                {feeds.length > 0 ? (
                    <EditFormComponent<NewsFeed>
                        title="Your Feed Subscriptions"
                        items={feeds}
                        groups={categories}
                        groupBy={"category" as keyof NewsFeed}
                        itemKey={"feedUrl"}
                        createNewGroup={false}
                        requireConfirmation={true}
                        switchBetweenModes={true}
                        enableMoveMode={false}
                        defaultMode={"edit"}
                        singleActions={["edit", "delete"]}
                        bulkActions={["delete"]}
                        moveItems={false}
                        enableSubgroup={false}
                        iconRounded={false}
                        onUpdate={async (updatedItems, updatedGroups) => {
                            // Placeholder: no individual update yet
                        }}
                        onEditItem={async (item, updated) => {
                            const originalFeed = feeds.find(f => f.feedUrl === item.feedUrl);
                            if (originalFeed) {
                                await updateFeed(item.feedUrl, { ...item, ...updated });
                            }
                        }}
                        onGroupAction={async (action, groupName, payload) => {
                            console.log(action);
                            console.log("test");
                            await handleGroupAction(action as "rename" | "delete", groupName, payload);
                        }}
                        renderAddItem={(
                            groupName: string,
                            onAdded: (item: NewsFeed) => void,
                            onCancel: () => void
                        ) => {
                            const DialogOpener: React.FC = () => {
                                useEffect(() => {
                                    setAddingGroup(groupName);
                                    addOnAddedRef.current = onAdded;
                                    setEditingFeed(null);
                                    setAddOpen(true);
                                    try {
                                        onCancel();
                                    } catch { }
                                    // eslint-disable-next-line react-hooks/exhaustive-deps
                                }, []);
                                return null;
                            };

                            return <DialogOpener />;
                        }}
                        renderEditItem={(
                            item: NewsFeed,
                            onSaved: (updated: NewsFeed) => void,
                            onCancel: () => void
                        ) => {
                            const DialogOpener: React.FC = () => {
                                useEffect(() => {
                                    setEditingFeed(item);
                                    setAddOpen(true);
                                    try {
                                        onCancel();
                                    } catch { }
                                    // eslint-disable-next-line react-hooks/exhaustive-deps
                                }, []);
                                return null;
                            };

                            return <DialogOpener />;
                        }}
                        renderRow={(item: NewsFeed) => (
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 flex items-center justify-center rounded overflow-hidden">
                                    {item.icon ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={item.icon}
                                            alt={`${item.name} icon`}
                                            className="object-contain w-full h-full"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 bg-gray-200 flex items-center justify-center text-xs">
                                            {item.name?.slice(0, 1).toUpperCase()}
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{item.name}</div>
                                    <div className="text-xs text-white/60 truncate">
                                        {item.feedUrl}
                                    </div>
                                </div>

                                {item.category && (
                                    <span className="text-xs px-2 py-1 rounded-full bg-(--surface-3)">
                                        {item.category}
                                    </span>
                                )}
                            </div>
                        )}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
                        <p className="text-lg text-white/70">
                            Add your first subscription to get started
                        </p>
                        <Button
                            onClick={() => {
                                setEditingFeed(null);
                                setAddOpen(true);
                            }}
                            className="px-5 py-2 rounded-md hover:opacity-90 transition"
                        >
                            Add feed
                        </Button>
                    </div>
                )}
            </div>

            {/* Subscription Details Dialog (controlled) */}
            <Dialog open={addOpen} onOpenChange={(v) => {
                setAddOpen(v);
                if (!v) {
                    setEditingFeed(null);
                    setAddingGroup("");
                    addOnAddedRef.current = null;
                }
            }}>
                <DialogContent className="frosted text-(--text-primary)">
                    <DialogHeader>
                        <DialogTitle>
                            {editingFeed ? "Edit Feed Subscription" : "Subscribe to Feed"}
                        </DialogTitle>
                    </DialogHeader>

                    <SubscriptionDetailsForm
                        feed={editingFeed || undefined}
                        categories={categories}
                        onClose={() => {
                            if (editingFeed) {
                                setAddOpen(false);
                                setEditingFeed(null);
                            } else {
                                setAddOpen(false);
                                setAddingGroup("");
                            }
                        }}
                        onSave={async (feed: NewsFeed) => {
                            if (editingFeed) {
                                // Update existing feed
                                await updateFeed(editingFeed.feedUrl, feed);
                            } else {
                                // Subscribe to new feed
                                await subscribeFeed(feed);
                                try {
                                    if (addOnAddedRef.current) {
                                        addOnAddedRef.current(feed);
                                        addOnAddedRef.current = null;
                                    }
                                } catch (e) {
                                    console.warn("onAdded callback failed", e);
                                }
                            }
                            setAddOpen(false);
                            setEditingFeed(null);
                            setAddingGroup("");
                        }}
                    />
                </DialogContent>
            </Dialog>
        </main>
    );
}
