"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RenameGroupDialog from "@/components/settings/RenameGroupDialog";
import SubscriptionDetailsForm from "@/components/news/SubscriptionDetailsForm";
import { Button } from "../ui/button";
import {
  EditItemsForm,
  useEditItemsForm,
  ListHeader,
  Modes,
  Tabs,
  Tab,
  CreateGroupAction,
  Actions,
  ListContent,
  ListItemPrototype,
  IndividualActions,
  Action,
  BulkActionsFooter,
  BulkItemsSelectedActions,
} from "@/components/EditItemsForm";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit, faTrash } from "@fortawesome/free-solid-svg-icons";

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

    // dialog state for rename group
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameDialogGroupName, setRenameDialogGroupName] = useState("");

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
        } catch (err) {
            console.error("group action failed", err);
            window.alert(`Failed to perform group action: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const handleGroupRename = async (groupName: string) => {
        setRenameDialogGroupName(groupName);
        setRenameDialogOpen(true);
    };

    const handleGroupRenameConfirm = async (newName: string) => {
        try {
            await handleGroupAction("rename", renameDialogGroupName, { newName });
            setRenameDialogOpen(false);
        } catch (err) {
            console.error("Failed to rename category:", err);
            // Dialog stays open on error so user can try again
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
                    <EditItemsForm<NewsFeed>
                        items={feeds}
                        groups={categories}
                        groupBy="category"
                        itemKey="feedUrl"
                        enableSubgroup={false}
                        onUpdate={async (updatedItems, updatedGroups) => {
                            // Items already updated via individual feed handlers
                        }}
                    >
                        {/* Header with Mode Toggle and Group Tabs */}
                        <ListHeader>
                            {/* Mode Toggle: Edit Mode */}
                            <Modes
                                editLabel="Edit"
                                moveLabel="Move"
                            />

                            {/* Group Tabs */}
                            <Tabs>
                                {categories.map((category) => (
                                    <Tab
                                        key={category}
                                        name={category}
                                        onRename={() => {
                                            setRenameDialogGroupName(category);
                                            setRenameDialogOpen(true);
                                        }}
                                        onDelete={() => {
                                            if (confirm(`Delete category "${category}"? Feeds will be unassigned.`)) {
                                                handleGroupAction("delete", category);
                                            }
                                        }}
                                    />
                                ))}
                            </Tabs>
                        </ListHeader>

                        {/* Feeds List */}
                        <FeedsListContent 
                            feeds={feeds}
                            onEditFeed={(feed) => {
                                setEditingFeed(feed);
                                setAddOpen(true);
                            }}
                            onDeleteFeed={(feed) => {
                                if (confirm(`Unsubscribe from "${feed.name}"?`)) {
                                    unsubscribeFeed(feed.feedUrl);
                                }
                            }}
                        />

                        {/* Bulk Actions Footer */}
                        <BulkActionsFooter>
                            <BulkItemsSelectedActions />
                        </BulkActionsFooter>
                    </EditItemsForm>
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

            {/* Rename Group Dialog */}
            <RenameGroupDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                currentName={renameDialogGroupName}
                onConfirm={handleGroupRenameConfirm}
                title="Rename category"
            />
        </main>
    );
}

/**
 * FeedsListContent - Helper component that uses useEditItemsForm hook
 * to filter feeds by current group and render them with actions
 */
function FeedsListContent({
    feeds,
    onEditFeed,
    onDeleteFeed,
}: {
    feeds: NewsFeed[];
    onEditFeed: (feed: NewsFeed) => void;
    onDeleteFeed: (feed: NewsFeed) => void;
}) {
    const { currentGroup, groupBy, mode } = useEditItemsForm<NewsFeed>();

    // Filter feeds by current group
    const filteredFeeds = feeds.filter(
        (feed) => (feed[groupBy as keyof NewsFeed] ?? "Uncategorized") === currentGroup
    );

    return (
        <ListContent>
            {filteredFeeds.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                    No feeds in this category
                </div>
            ) : (
                filteredFeeds.map((feed) => (
                    <ListItemPrototype
                        key={feed.feedUrl}
                        item={feed}
                    >
                        <div className="flex items-center gap-3 flex-1">
                            {/* Feed Icon */}
                            <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded overflow-hidden">
                                {feed.icon ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={feed.icon}
                                        alt={`${feed.name} icon`}
                                        className="object-contain w-full h-full"
                                    />
                                ) : (
                                    <div className="w-8 h-8 bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                        {feed.name?.slice(0, 1).toUpperCase()}
                                    </div>
                                )}
                            </div>

                            {/* Feed Info */}
                            <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{feed.name}</div>
                                <div className="text-xs text-white/60 truncate">
                                    {feed.feedUrl}
                                </div>
                            </div>
                        </div>

                        {/* Actions (Edit/Delete) */}
                        {mode === "edit" && (
                            <IndividualActions>
                                <Action
                                    type="edit"
                                    label="Edit"
                                    onClick={() => onEditFeed(feed)}
                                />
                                <Action
                                    type="delete"
                                    label="Delete"
                                    onClick={() => onDeleteFeed(feed)}
                                />
                            </IndividualActions>
                        )}
                    </ListItemPrototype>
                ))
            )}
        </ListContent>
    );
}
