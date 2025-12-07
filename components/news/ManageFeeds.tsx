"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";
import EditFormComponent from "@/components/settings/EditForm";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";

type NewsFeed = {
    id?: string;
    feedUrl: string;
    name: string;
    icon?: string;
    category?: string;
};

export default function ManageFeedsComponent() {
    const { config, refreshConfig } = useConfig();
    const router = useRouter();
    const [feeds, setFeeds] = useState<NewsFeed[]>([]);
    const [loading, setLoading] = useState(true);

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

    const handleGroupAction = async (action: "rename" | "delete", groupName: string, payload?: any) => {
        try {
            console.log("group action")
            if (action === "rename") {
                console.log(payload)
            } else if (action === "delete") {

            }
        } catch (err) {
            console.error("group action failed", err);
            window.alert("Failed to perform group action");
        }

    };

    if (loading) {
        return <div className="text-center py-8">Loading feeds...</div>;
    }

    return (
        <main className="text-(--text-primary) p-4">
            <h1 className="text-2xl font-semibold mb-4">Manage Feeds</h1>

            <div className="content space-y-2">
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
                        // When edit/delete happens, we handle it differently
                    }}
                    onEditItem={async (item) => {
                        // Placeholder: no individual update yet
                        console.log("Edit feed:", item);
                    }}
                    onGroupAction={async (action, groupName, payload) => {
                        await handleGroupAction(action as "rename" | "delete", groupName, payload);
                    }}
                    renderAddItem={(groupName: string, onAdded: (item: NewsFeed) => void, onCancel: () => void) => {
                        const AddFeedDialog: React.FC = () => {
                            const [feedUrl, setFeedUrl] = useState("");
                            const [name, setName] = useState("");
                            const [icon, setIcon] = useState("");
                            const [category, setCategory] = useState(categories.length ? categories[0] : "Uncategorized");
                            const [customCategory, setCustomCategory] = useState("");
                            const [useCustom, setUseCustom] = useState(false);
                            const [error, setError] = useState("");
                            const [saving, setSaving] = useState(false);

                            const handleSubscribe = async () => {
                                if (!feedUrl.trim()) {
                                    setError("Feed URL is required");
                                    return;
                                }

                                const finalCategory = useCustom ? customCategory.trim() || "Uncategorized" : (category || "Uncategorized");

                                setSaving(true);
                                try {
                                    await subscribeFeed({
                                        feedUrl: feedUrl.trim(),
                                        name: name.trim() || "",
                                        icon: icon.trim() || "",
                                        category: finalCategory,
                                    });
                                    onAdded({
                                        feedUrl: feedUrl.trim(),
                                        name: name.trim() || "",
                                        icon: icon.trim() || "",
                                        category: finalCategory,
                                    });
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : "Failed to subscribe");
                                } finally {
                                    setSaving(false);
                                }
                            };

                            return (
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <div className="px-3 py-2 bg-blue-600 text-white rounded inline-block cursor-pointer">Add Feed</div>
                                    </DialogTrigger>
                                    <DialogContent className="frosted text-(--text-primary)">
                                        <DialogHeader>
                                            <DialogTitle>Add Feed</DialogTitle>
                                            <DialogDescription>Subscribe to a new RSS/Atom feed</DialogDescription>
                                        </DialogHeader>

                                        <div className="space-y-4 mt-2">
                                            <div>
                                                <label className="block text-sm font-medium mb-1">Feed URL *</label>
                                                <input
                                                    type="text"
                                                    placeholder="https://example.com/feed.xml"
                                                    value={feedUrl}
                                                    onChange={(e) => setFeedUrl(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-md bg-(--surface-3) border border-(--surface-4)"
                                                    disabled={saving}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium mb-1">Feed Name</label>
                                                <input
                                                    type="text"
                                                    placeholder="My Feed"
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-md bg-(--surface-3) border border-(--surface-4)"
                                                    disabled={saving}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium mb-1">Icon URL</label>
                                                <input
                                                    type="text"
                                                    placeholder="https://example.com/icon.png"
                                                    value={icon}
                                                    onChange={(e) => setIcon(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-md bg-(--surface-3) border border-(--surface-4)"
                                                    disabled={saving}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium mb-1">Category</label>
                                                <select
                                                    value={useCustom ? "__custom__" : category}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v === "__custom__") {
                                                            setUseCustom(true);
                                                        } else {
                                                            setUseCustom(false);
                                                            setCategory(v);
                                                        }
                                                    }}
                                                    className="w-full px-3 py-2 rounded-md bg-(--surface-3) border border-(--surface-4)"
                                                    disabled={saving}
                                                >
                                                    {categories.length === 0 && <option value="Uncategorized">Uncategorized</option>}
                                                    {categories.map((c) => (
                                                        <option key={c} value={c}>{c}</option>
                                                    ))}
                                                    <option value="__custom__">New category...</option>
                                                </select>

                                                {useCustom && (
                                                    <input
                                                        type="text"
                                                        placeholder="Enter custom category"
                                                        value={customCategory}
                                                        onChange={(e) => setCustomCategory(e.target.value)}
                                                        className="w-full mt-2 px-3 py-2 rounded-md bg-(--surface-3) border border-(--surface-4)"
                                                        disabled={saving}
                                                    />
                                                )}

                                                <div className="text-xs text-white/60 mt-1">Name and icon are added automatically if left empty.</div>
                                            </div>

                                            {error && <div className="text-red-500 text-sm">{error}</div>}

                                            <DialogFooter>
                                                <div className="flex gap-2 w-full">
                                                    <button
                                                        onClick={handleSubscribe}
                                                        disabled={saving}
                                                        className="flex-1 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        {saving ? "Subscribing..." : "Subscribe"}
                                                    </button>
                                                    <DialogClose asChild>
                                                        <button
                                                            onClick={onCancel}
                                                            disabled={saving}
                                                            className="flex-1 px-4 py-2 rounded-md bg-(--surface-3) text-white hover:bg-(--surface-4) disabled:opacity-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </DialogClose>
                                                </div>
                                            </DialogFooter>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            );
                        };

                        return <AddFeedDialog />;
                    }}
                    renderRow={(item: NewsFeed, isSelected, mode) => (
                        <div className="flex items-center gap-3">
                            {/* small icon */}
                            <div className="w-8 h-8 flex items-center justify-center rounded overflow-hidden">
                                {item.icon ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.icon} alt={`${item.name} icon`} className="object-contain w-full h-full" />
                                ) : (
                                    <div className="w-8 h-8 bg-gray-200 flex items-center justify-center text-xs">
                                        {item.name?.slice(0, 1).toUpperCase()}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{item.name}</div>
                                <div className="text-xs text-white/60 truncate">{item.feedUrl}</div>
                            </div>

                            {item.category && (
                                <span className="text-xs px-2 py-1 rounded-full bg-(--surface-3)">
                                    {item.category}
                                </span>
                            )}
                        </div>
                    )}
                />
            </div>
        </main>
    );
}