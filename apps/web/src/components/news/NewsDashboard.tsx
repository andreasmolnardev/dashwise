"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import { Button } from "../ui/button";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import NewsFeedEditModal from "./NewsFeedEditModal";
import SubscriptionDetailsForm from "./SubscriptionDetailsForm";
import {
    getNewsFeedAction,
    getNewsFeedRecordAction,
    getNewsFeedMetadataAction,
    getNewsFeedsAction,
    getNewsSubscriptionsAction,
    refreshNewsFeedAction,
    subscribeNewsFeedAction,
    unsubscribeNewsFeedAction,
    updateNewsFeedAction,
    updateNewsFeedRecordAction,
} from "@/app/actions/news";
import type {
    NewsFeedDraft,
    NewsFeedItem,
    NewsFeedRecord,
    NewsFeedSummary,
    NewsFeedsResponse,
    NewsSubscriptionsResponse,
} from "@dashwise/sdk/data/news";

export default function NewsDashboardComponent(
    children: React.PropsWithChildren<{}> = {},
) {
    const navigate = useNavigate();
    const { feedId } = useParams();
    const [searchParams] = useSearchParams();
    const activeFeedId = feedId || "all";
    const sidebarAction = searchParams.get("action");
    const editSubscriptionRef = searchParams.get("subscription");
    const editFeedRef = searchParams.get("feed");

    const [feed, setFeed] = useState<NewsFeedItem[] | null>(null);
    const [subscriptions, setSubscriptions] = useState<NewsFeedDraft[] | null>(
        null,
    );
    const [feeds, setFeeds] = useState<NewsFeedSummary[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [addOpen, setAddOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<NewsFeedDraft | null>(null);
    const [editFeedOpen, setEditFeedOpen] = useState(false);
    const [editingNewsFeed, setEditingNewsFeed] = useState<NewsFeedRecord | null>(null);
    const [loadingFeedRecord, setLoadingFeedRecord] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

    const itemsPerPage = 15;
    const { token, withAuth } = useAuth();

    // --- Auth redirect ---
    useEffect(() => {
        if (!token) navigate("/auth/login");
    }, [navigate, token]);

    if (!token) return null;

    const loadSubscriptions = async () => {
        if (!token) return;

        try {
            const [subscriptionsData, feedsData]: [NewsSubscriptionsResponse, NewsFeedsResponse] = await Promise.all([
                withAuth((auth) => getNewsSubscriptionsAction(auth)),
                withAuth((auth) => getNewsFeedsAction(auth)),
            ]);

            setSubscriptions(subscriptionsData.subscriptions ?? []);
            setFeeds(Array.isArray(feedsData.feeds) ? feedsData.feeds : []);
        } catch (err) {
            console.error("Failed to load subscriptions:", err);
        }
    };

    const loadFeed = async () => {
        if (!token) return;

        try {
            const data = await withAuth((auth) =>
                getNewsFeedAction(auth, activeFeedId)
            );
            setFeed(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to load news:", err);
        }
    };

    // --- Fetch news ---
    useEffect(() => {
        loadSubscriptions();
    }, [token, withAuth]);

    useEffect(() => {
        setCurrentPage(1);
        loadFeed();
    }, [token, activeFeedId]);

    useEffect(() => {
        if (!sidebarAction) return;

        if (sidebarAction === "subscribe") {
            setEditingFeed(null);
            setAddOpen(true);
            navigate(
                `/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`
                    .replace(/\/$/, ""),
                { replace: true },
            );
            return;
        }

        if (
            sidebarAction === "edit" && editSubscriptionRef &&
            subscriptions?.length
        ) {
            const target = subscriptions.find((subscription) =>
                subscription.id === editSubscriptionRef ||
                subscription.url === editSubscriptionRef
            );

            if (target) {
                setEditingFeed(target);
                setAddOpen(true);
            }
            navigate(
                `/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`
                    .replace(/\/$/, ""),
                { replace: true },
            );
        }
    }, [
        sidebarAction,
        editSubscriptionRef,
        subscriptions,
        activeFeedId,
        navigate,
    ]);

    useEffect(() => {
        if (sidebarAction !== "edit-feed" || !editFeedRef) {
            setEditFeedOpen(false);
            setEditingNewsFeed(null);
            setLoadingFeedRecord(false);
            return;
        }

        let mounted = true;
        setEditFeedOpen(true);
        setLoadingFeedRecord(true);

        const feedSummary = feeds.find((entry) => entry.id === editFeedRef);
        const derivedSubscriptionRefs = editFeedRef === "all"
            ? []
            : (subscriptions ?? [])
                .filter((subscription) => subscription.id && subscription.feedIds?.includes(editFeedRef))
                .map((subscription) => String(subscription.id))
                .filter(Boolean);

        const fallbackRecord: NewsFeedRecord = {
            id: editFeedRef,
            title: feedSummary?.title || (editFeedRef === "all" ? "All feed" : "Untitled feed"),
            subscriptionRefs: derivedSubscriptionRefs,
            excludedSubscriptionRefs: [],
        };

        if (editFeedRef !== "all") {
            setEditingNewsFeed(fallbackRecord);
            setLoadingFeedRecord(false);
            return;
        }

        withAuth((auth) => getNewsFeedRecordAction(auth, editFeedRef))
            .then((record) => {
                if (!mounted) return;
                setEditingNewsFeed(record || fallbackRecord);
            })
            .catch((err) => {
                console.error("Failed to load feed record:", err);
                if (mounted) {
                    setEditingNewsFeed(fallbackRecord);
                }
            })
            .finally(() => {
                if (mounted) {
                    setLoadingFeedRecord(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [sidebarAction, editFeedRef, feeds, subscriptions, withAuth]);

    const closeFeedEditor = () => {
        navigate(`/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`.replace(/\/$/, ""), { replace: true });
        setEditFeedOpen(false);
        setEditingNewsFeed(null);
        setLoadingFeedRecord(false);
    };

    const currentSubscription = subscriptions?.find((subscription) =>
        subscription.id === activeFeedId || subscription.url === activeFeedId
    ) ?? null;

    const openCurrentSubscriptionEditor = () => {
        if (!currentSubscription) return;

        setEditingFeed(currentSubscription);
        setAddOpen(true);
    };

    const getRefreshTargetFeedIds = (explicitFeedIds?: string[]) => {
        if (explicitFeedIds && explicitFeedIds.length > 0) {
            return explicitFeedIds.map(String).filter(Boolean);
        }

        if (activeFeedId === "all") {
            return feeds.map((entry) => entry.id).filter(Boolean);
        }

        return [activeFeedId].filter(Boolean);
    };

    const refreshFeeds = async (
        targetLabel: string = "current feed",
        explicitFeedIds?: string[],
    ) => {
        if (!token) return;
        const targetFeedIds = getRefreshTargetFeedIds(explicitFeedIds);
        if (!targetFeedIds.length) {
            return;
        }

        setIsRefreshing(true);
        setRefreshStatus(`Refreshing ${targetLabel}…`);
        try {
            await withAuth((auth) => refreshNewsFeedAction(auth, targetFeedIds));
            setRefreshStatus("Fetching latest articles…");
            await loadFeed();
        } catch (err) {
            console.error("Refresh failed:", err);
        } finally {
            setIsRefreshing(false);
            setRefreshStatus(null);
        }
    };

    const subscribeFeed = async (feed: NewsFeedDraft) => {
        if (!token) throw new Error("Not authenticated");

        await withAuth((auth) =>
            subscribeNewsFeedAction(auth, {
                feedUrl: String(feed.feedUrl ?? feed.url ?? ""),
                name: String(feed.name ?? feed.title ?? ""),
                icon: String(feed.icon ?? ""),
                feedIds: feed.feedIds ?? [],
                newFeedTitles: feed.newFeedTitles ?? [],
                linkReplaceRule: feed.linkReplaceRule,
                fallbackThumbnailUrl: feed.fallbackThumbnailUrl,
                thumbnailOverwriteUrl: feed.thumbnailOverwriteUrl,
            })
        );

        await loadSubscriptions();
        await refreshFeeds(
            String(feed.name ?? feed.title ?? feed.feedUrl ?? feed.url ?? "new feed"),
            feed.feedIds ?? [],
        );
    };

    const unsubscribeFeed = async (subscription: NewsFeedDraft) => {
        if (!token) throw new Error("Not authenticated");

        await withAuth((auth) =>
            unsubscribeNewsFeedAction(auth, String(subscription.id ?? subscription.url ?? ""))
        );

        await loadSubscriptions();
        await refreshFeeds(
            subscription.title || subscription.name || subscription.url || subscription.feedUrl || "feed",
            subscription.feedIds || [],
        );
    };

    const updateFeed = async (subscriptionId: string, updatedFeed: NewsFeedDraft) => {
        if (!token) throw new Error("Not authenticated");

        await withAuth((auth) =>
            updateNewsFeedAction(auth, {
                subscriptionId,
                feedUrl: String(updatedFeed.feedUrl ?? updatedFeed.url ?? ""),
                title: String(updatedFeed.name ?? updatedFeed.title ?? ""),
                icon: String(updatedFeed.icon ?? ""),
                feedIds: updatedFeed.feedIds ?? [],
                linkReplaceRule: updatedFeed.linkReplaceRule,
                fallbackThumbnailUrl: updatedFeed.fallbackThumbnailUrl,
                thumbnailOverwriteUrl: updatedFeed.thumbnailOverwriteUrl,
            })
        );

        await loadSubscriptions();
        await refreshFeeds(
            String(updatedFeed.name ?? updatedFeed.title ?? updatedFeed.feedUrl ?? updatedFeed.url ?? "feed"),
            updatedFeed.feedIds ?? [],
        );
    };

    // --- Scroll to top on page change ---
    useEffect(() => {
        const container = document.getElementById("news-scroll-container");
        if (container) {
            container.scrollTo({ top: 0, behavior: "smooth" });
        }
    }, [currentPage, activeFeedId]);

    const selectedSubscription = subscriptions?.find((subscription) => {
        return subscription.id === activeFeedId;
    }) || null;

    const selectedFeed = feeds.find((entry) => entry.id === activeFeedId) ||
        null;

    const selectedSource = selectedSubscription?.title ||
        selectedSubscription?.url || selectedFeed?.title || null;
    const selectedCategory = activeFeedId === "all"
        ? "All"
        : selectedFeed?.title || "Feed";

    const getIconUrl = (name: string) => {
        if (!subscriptions) {
            return "";
        }

        const subscription = subscriptions.find((s) =>
            s.title === name || s.name === name || s.url === name ||
            s.feedUrl === name || s.id === name
        );

        if (subscription) {
            return subscription.icon ?? "";
        }
    };

    const allArticles = feed
        ? [...feed].sort((a, b) =>
            new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
        )
        : [];

    const totalPages = Math.ceil(allArticles.length / itemsPerPage);
    const paginatedArticles = allArticles.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
    );

    return (
        <div className="grid grid-rows-[auto_auto_1fr_auto] min-h-0 h-dvh p-0 overflow-hidden text-(--surface-foreground) bg-(--surface)">
            {/* HEADER */}
            <header className="flex items-center justify-between gap-2 pb-4">
                <h2 className="font-semibold text-lg md:text-3xl truncate ">
                    {selectedSource || selectedCategory || "All feed"}
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={openCurrentSubscriptionEditor}
                        disabled={!currentSubscription || isRefreshing}
                        className={`
                            flex items-center justify-center h-9 rounded-full frosted gap-2
                            transition-all duration-300 hover:bg-white/10 px-2
                            ${!currentSubscription || isRefreshing ? "opacity-50" : "opacity-80 hover:opacity-100"}
                        `}
                        title={currentSubscription ? "Edit subscription" : "No subscription to edit"}
                    >
                        <Icon icon="fa6-solid:pen-to-square" />
                    </button>
                    <button
                        onClick={() => refreshFeeds()}
                        disabled={isRefreshing}
                        className={`
                            flex items-center justify-center h-9 rounded-full frosted gap-2
                            transition-all duration-300 hover:bg-white/10 px-2
                            ${
                            isRefreshing
                                ? "opacity-50"
                                : "opacity-80 hover:opacity-100"
                        }
                        `}
                        title="Refresh all feeds"
                    >
                        <Icon
                            icon="fa6-solid:arrows-rotate"
                            className={`${isRefreshing ? "animate-spin" : ""}`}
                        />
                    </button>
                </div>
            </header>

            {/* MAIN */}
            <main
                id="page-content-container"
                className="
            flex flex-col md:flex-row gap-2 min-h-0 rounded-2xl w-full min-w-0
        "
            >
                {/* NEWS PANEL */}
                <div
                    id="news-scroll-container"
                    className="
                w-full md:w-auto grow
                space-y-3.5 overflow-y-auto min-w-0
            "
                >
                    <section className="space-y-3.5 pb-10">
                        {!feed && (
                            <div className="opacity-60">Loading news…</div>
                        )}

                        {feed &&
                            paginatedArticles.map((item, idx) => (
                                <NewsArticle
                                    key={idx}
                                    item={item}
                                    iconUrl={getIconUrl(item.subscription_id || item.subscription_name)}
                                />
                            ))}

                        {/* Pagination */}
                        {feed && totalPages > 1 && (
                            <div className="py-8">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <PaginationPrevious
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    if (currentPage > 1) {
                                                        setCurrentPage(
                                                            currentPage - 1,
                                                        );
                                                    }
                                                }}
                                                className={currentPage === 1
                                                    ? "pointer-events-none opacity-50"
                                                    : "cursor-pointer"}
                                            />
                                        </PaginationItem>

                                        {Array.from(
                                            { length: totalPages },
                                            (_, i) => i + 1,
                                        ).map((page) => {
                                            // Logic to show limited page numbers with ellipsis
                                            if (
                                                page === 1 ||
                                                page === totalPages ||
                                                (page >= currentPage - 1 &&
                                                    page <= currentPage + 1)
                                            ) {
                                                return (
                                                    <PaginationItem key={page}>
                                                        <PaginationLink
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                setCurrentPage(
                                                                    page,
                                                                );
                                                            }}
                                                            isActive={currentPage ===
                                                                page}
                                                            className="cursor-pointer"
                                                        >
                                                            {page}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                );
                                            } else if (
                                                page === currentPage - 2 ||
                                                page === currentPage + 2
                                            ) {
                                                return (
                                                    <PaginationItem key={page}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                );
                                            }
                                            return null;
                                        })}

                                        <PaginationItem>
                                            <PaginationNext
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    if (
                                                        currentPage < totalPages
                                                    ) {
                                                        setCurrentPage(
                                                            currentPage + 1,
                                                        );
                                                    }
                                                }}
                                                className={currentPage ===
                                                        totalPages
                                                    ? "pointer-events-none opacity-50"
                                                    : "cursor-pointer"}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {/* Subscription Details Dialog */}
            <Dialog
                open={addOpen}
                onOpenChange={(v) => {
                    setAddOpen(v);
                    if (!v) setEditingFeed(null);
                }}
            >
                <DialogContent className="frosted text-foreground max-h-[90vh] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {editingFeed
                                ? "Edit Subscription"
                                : "Add new Subscription"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="max-h-[calc(90vh-6rem)] overflow-y-auto pr-2">
                        <SubscriptionDetailsForm
                            feed={editingFeed
                                ? {
                                    id: editingFeed.id,
                                    feedUrl: String(editingFeed.feedUrl ?? editingFeed.url ?? ""),
                                    name: String(editingFeed.name ?? editingFeed.title ?? editingFeed.url ?? ""),
                                    icon: editingFeed.icon,
                                    feedIds: editingFeed.feedIds || [],
                                    linkReplaceRule: editingFeed.linkReplaceRule,
                                    fallbackThumbnailUrl: editingFeed.fallbackThumbnailUrl,
                                    thumbnailOverwriteUrl: editingFeed.thumbnailOverwriteUrl,
                                }
                                : undefined}
                            feeds={feeds}
                            resolveFeedMetadata={(feedUrl) =>
                                withAuth((auth) => getNewsFeedMetadataAction(auth, feedUrl))
                            }
                            onClose={() => {
                                setAddOpen(false);
                                setEditingFeed(null);
                            }}
                            onSave={async (feed: any) => {
                                try {
                                    if (editingFeed) {
                                        await updateFeed(
                                            String(editingFeed.id ?? editingFeed.url ?? ""),
                                            feed,
                                        );
                                    } else {
                                        await subscribeFeed(feed);
                                    }
                                    setAddOpen(false);
                                    setEditingFeed(null);
                                } catch (err) {
                                    console.error("Failed to save feed:", err);
                                }
                            }}
                            onDelete={async (feedId) => {
                                try {
                                    await unsubscribeFeed({ id: feedId } as any);
                                    setAddOpen(false);
                                    setEditingFeed(null);
                                } catch (err) {
                                    console.error("Failed to delete feed:", err);
                                }
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <NewsFeedEditModal
                open={editFeedOpen}
                feed={editingNewsFeed}
                loading={loadingFeedRecord}
                subscriptions={(subscriptions ?? [])
                    .filter((subscription) => subscription.id)
                    .map((subscription) => ({
                        id: String(subscription.id),
                        title: String(subscription.title || subscription.name || subscription.url || "Untitled subscription"),
                    }))}
                onClose={closeFeedEditor}
                onSave={async (payload) => {
                    await withAuth((auth) => updateNewsFeedRecordAction(auth, payload));
                    setEditFeedOpen(false);
                    setEditingNewsFeed(null);
                    await loadSubscriptions();
                }}
            />

            
        </div>
    );
}

function NewsArticle({ item, iconUrl }: { item: any; iconUrl?: string }) {
    return (
        <div className="rounded-xl bg-(--surface-2) w-full">
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_3fr]">
                {item.thumbnailUrl
                    ? (
                        <img
                            src={item.thumbnailUrl}
                            className="w-full aspect-1.5/1 object-cover rounded-xl"
                        />
                    )
                    : 
                    <div className="w-full aspect-1.5/1 frosted rounded-xl" />}

                <div className="min-w-0">
                    <a
                        href={item.link}
                        target="_blank"
                        className="
                font-semibold
                line-clamp-2
                text-base md:text-lg
                hover:text-primary
            "
                    >
                        {item.title}
                    </a>

                    <div className="flex flex-wrap justify-between text-xs mt-1 opacity-80 gap-y-1">
                        <div className="flex items-center gap-1 flex-wrap">
                            {item.subscription_name && (
                                <span className="flex items-center gap-1">
                                    {iconUrl && (
                                        <img
                                            src={iconUrl}
                                            alt={item.subscription_name}
                                            className="h-4"
                                        />
                                    )}
                                    {item.subscription_name}
                                </span>
                            )}
                            {item.author && (
                                <span className="before:content-['•'] before:mx-1 opacity-60">
                                    {item.author}
                                </span>
                            )}
                        </div>
                        <p>{formatRelativeTime(item.pubDate)}</p>
                    </div>

                    {item.description && (
                        <p className="text-sm md:text-[0.95rem] opacity-80 line-clamp-2 mt-1">
                            {item.description}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export function formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();

    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Just now
    if (diffSeconds < 60) {
        return "Just now";
    }

    // Minutes ago
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    // Hours ago
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const isYesterday = date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
        return `Yesterday at ${
            date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
            })
        }`;
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString([], {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    // Fallback
    return date.toISOString().split("T")[0];
}
