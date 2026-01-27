"use client";

import { useConfig } from "@/context/ConfigContext";
import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCaretDown, faEllipsisVertical, faPlus, faEdit, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Button } from "../ui/button";
import TabSwitcher from "../common/TabSwitcher";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SubscriptionDetailsForm from "@/components/news/SubscriptionDetailsForm";

interface Subscription {
    name: string;
    icon?: string;
    category: string;
    feedUrl: string;
}


export default function NewsDashboardComponent(
    children: React.PropsWithChildren<{}> = {}
) {
    const { config } = useConfig();
    const router = useRouter();

    const [feed, setFeed] = useState<Record<string, any[]> | null>(null);
    const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<Subscription | null>(null);

    const itemsPerPage = 15;
    const { token } = useAuth();

    const categories = Array.from(new Set(subscriptions?.map((s) => s.category) ?? [])).sort();
    const tabItems = [
        { value: "All", label: "All" },
        ...categories.map((cat) => ({ value: cat, label: cat })),
    ];

    const currentCategorySources = subscriptions
        ? subscriptions.filter(s => selectedCategory === "All" || s.category === selectedCategory)
        : [];

    // --- Auth redirect ---
    useEffect(() => {
        if (!token) router.push("/auth/login");
    }, [router, token]);

    if (!token) return null;

    // --- Prefetch manage page ---
    useEffect(() => {
        router.prefetch("/manage-feeds");
    }, [router]);

    const loadData = async () => {
        if (!token) return;
        const url = new URL("/api/v1/news", window.location.origin);
        if (selectedCategory !== "All") {
            url.searchParams.set("category", selectedCategory);
        }

        const res = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!res.ok) return;

        const data = await res.json();
        setFeed(data.feed);
        setSubscriptions(data.subscriptions);
        setCurrentPage(1); // Reset to first page on category change
        setSelectedSource(null); // Reset source filter on category change
    };

    // --- Fetch news ---
    useEffect(() => {
        loadData();
    }, [token, selectedCategory]);

    const subscribeFeed = async (feed: any) => {
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

        await loadData();
    };

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

        await loadData();
    };

    const updateFeed = async (oldFeedUrl: string, updatedFeed: any) => {
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

        await loadData();
    };

    // --- Scroll to top on page change ---
    useEffect(() => {
        const container = document.getElementById("news-scroll-container");
        if (container) {
            container.scrollTo({ top: 0, behavior: "smooth" });
        }
    }, [currentPage, selectedSource]);

    const getIconUrl = (name) => {
        if (!subscriptions) {
            return "";
        }

        const subscription = subscriptions.find(s => s.name === name);

        if (subscription) {
            return subscription.icon ?? "";
        }
    }

    // Flatten and sort articles
    const allArticles = feed
        ? Object.entries(feed).flatMap(([category, articles]) =>
            articles.map((a) => ({ ...a, category }))
        )
            .filter((a) => !selectedSource || a.source === selectedSource)
            .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
        : [];

    const totalPages = Math.ceil(allArticles.length / itemsPerPage);
    const paginatedArticles = allArticles.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="grid grid-rows-[auto_auto_1fr_auto] min-h-0 h-dvh pt-5 md:p-3.5 p-0 overflow-hidden text-(--surface-foreground) bg-(--surface)">
            {/* HEADER */}
            <header className="flex gap-2 items-center px-3 md:px-6 h-[40px]">
                <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
                <span className="font-semibold">News</span>
            </header>

            {/* TABS */}
            <div className="px-3 md:px-6 py-4 overflow-x-auto scrollbar-hide h-14">
                <TabSwitcher
                    value={selectedCategory}
                    onValueChange={setSelectedCategory}
                    items={tabItems}
                />
            </div>

            {/* MAIN */}
            <main
                id="page-content-container"
                className="
            flex flex-col md:flex-row gap-2 min-h-0 rounded-2xl w-full min-w-0
            px-3 md:px-6
        "
            >
                {/* SOURCE SELECT PANEL */}
                {currentCategorySources.length >= 0 && (
                    <aside className="
                    flex md:flex-col items-center
                    gap-4 px-5 md:px-0 py-5 md:py-6 
                    overflow-x-scroll md:overflow-y-scroll overflow-y-hidden
                    min-w-0 md:min-w-22 frosted rounded-full h-fit max-h-full max-w-full">
                        {currentCategorySources.map((sub) => (
                            <div key={sub.name} className="relative group">
                                <button
                                    onClick={() => {
                                        setSelectedSource(selectedSource === sub.name ? null : sub.name);
                                        setCurrentPage(1);
                                    }}
                                    title={sub.name}
                                    className={`
                                        flex justify-center items-center rounded-full gap-3 min-h-12 aspect-square transition-all duration-200
                                        ${selectedSource === sub.name ? "bg-white/15 text-white ring-1 ring-(--accent-color)" : "opacity-50 hover:opacity-100 hover:bg-white/5"}
                                    `}
                                >
                                    {sub.icon ? (
                                        <img src={sub.icon} alt={sub.name} className="object-contain pointer-events-none max-w-8 aspect-square" />
                                    ) : (
                                        <span className="text-xs font-bold uppercase">{sub.name.slice(0, 2)}</span>
                                    )}
                                </button>

                                {/* Hover actions */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Unsubscribe from "${sub.name}"?`)) {
                                            unsubscribeFeed(sub.feedUrl);
                                        }
                                    }}
                                    className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full frosted text-white text-[10px] shadow-lg hover:scale-110 transition-transform"
                                    title="Unsubscribe"
                                >
                                    <FontAwesomeIcon icon={faXmark} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingFeed(sub);
                                        setAddOpen(true);
                                    }}
                                    className="absolute -top-1 -left-1 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full frosted text-white text-[10px] shadow-lg hover:scale-110 transition-transform"
                                    title="Edit feed"
                                >
                                    <FontAwesomeIcon icon={faEdit} />
                                </button>
                            </div>
                        ))}

                        {/* Add feed button */}
                        <button
                            onClick={() => {
                                setEditingFeed(null);
                                setAddOpen(true);
                            }}
                            className="flex justify-center items-center rounded-full min-h-12 aspect-square border-2 border-dashed border-white/30 text-white/50 hover:text-white hover:border-white/60 transition-all duration-200"
                            title="Add feed"
                        >
                            <FontAwesomeIcon icon={faPlus} />
                        </button>
                    </aside>
                )}

                {/* NEWS PANEL */}
                <div
                    id="news-scroll-container"
                    className="
                w-full md:w-auto flex-grow
                space-y-3.5 overflow-y-auto min-w-0
            "
                >
                    <section className="space-y-3.5 pb-10">
                        {!feed && (
                            <div className="opacity-60">Loading news…</div>
                        )}

                        {feed && paginatedArticles.map((item, idx) => (
                            <NewsArticle
                                key={idx}
                                item={item}
                                iconUrl={getIconUrl(item.source)}
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
                                                    if (currentPage > 1) setCurrentPage(currentPage - 1);
                                                }}
                                                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                            />
                                        </PaginationItem>

                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                                            // Logic to show limited page numbers with ellipsis
                                            if (
                                                page === 1 ||
                                                page === totalPages ||
                                                (page >= currentPage - 1 && page <= currentPage + 1)
                                            ) {
                                                return (
                                                    <PaginationItem key={page}>
                                                        <PaginationLink
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                setCurrentPage(page);
                                                            }}
                                                            isActive={currentPage === page}
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
                                                    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                                                }}
                                                className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </section>
                </div>

                {/* RIGHT PANEL (optional, swipe-enabled on mobile)
                    <div
                        id="right-news-panel"
                        className="
                            w-screen md:w-auto flex-grow snap-start
                            space-y-3.5 overflow-y-auto min-w-0
                        "
                    >
                        Right news panel here
                    </div>
                    */}
            </main>

            {/* FOOTER */}
            <footer
                id="page-footer"
                className="
            flex flex-col gap-2
            md:flex-row md:justify-between md:items-center
            px-3 md:px-6 py-2
        "
            >
                <Link
                    href="/home"
                    className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm"
                >
                    <FontAwesomeIcon icon={faArrowLeft} />
                    Back to dashboard
                </Link>

            </footer>

            {/* Subscription Details Dialog */}
            <Dialog open={addOpen} onOpenChange={(v) => {
                setAddOpen(v);
                if (!v) setEditingFeed(null);
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
                            setAddOpen(false);
                            setEditingFeed(null);
                        }}
                        onSave={async (feed: any) => {
                            try {
                                if (editingFeed) {
                                    await updateFeed(editingFeed.feedUrl, feed);
                                } else {
                                    await subscribeFeed(feed);
                                }
                                setAddOpen(false);
                                setEditingFeed(null);
                            } catch (err) {
                                console.error("Failed to save feed:", err);
                                alert(err instanceof Error ? err.message : "Failed to save feed");
                            }
                        }}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}

function NewsArticle({ item, iconUrl }: { item: any; iconUrl?: string }) {
    return (
        <div className="p-3 rounded-xl bg-(--surface-2) w-full">
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_3fr]">
                {item.thumbnailUrl ? (
                    <img
                        src={item.thumbnailUrl}
                        className="w-full aspect-[1.5/1] object-cover rounded-xl"
                    />
                ) : (
                    <div className="w-full aspect-[1.5/1] frosted rounded-xl" />
                )}

                <div className="min-w-0">
                    <a
                        href={item.link}
                        target="_blank"
                        className="
                font-semibold
                line-clamp-2
                text-base md:text-lg
                hover:text-(--primary)
            "
                    >
                        {item.title}
                    </a>

                    <div className="flex flex-wrap justify-between text-xs mt-1 opacity-80 gap-y-1">
                        <div className="flex items-center gap-1 flex-wrap">
                            {item.source && (
                                <span className="flex items-center gap-1">
                                    {iconUrl && (
                                        <img
                                            src={iconUrl}
                                            alt={item.source}
                                            className="h-4"
                                        />
                                    )}
                                    {item.source}
                                </span>
                            )}
                            {item.category && (
                                <span className="before:content-['•'] before:mx-1 opacity-60">
                                    {item.category}
                                </span>
                            )}
                            {item.author && (
                                <span className="before:content-['•'] before:mx-1 opacity-60">
                                    {item.author}
                                </span>
                            )}
                        </div>
                        <p> {formatRelativeTime(item.pubDate)}</p>
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
    const date = new Date(isoDate)
    const now = new Date()

    const diffMs = now.getTime() - date.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)

    // Just now
    if (diffSeconds < 60) {
        return "Just now"
    }

    // Minutes ago
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`
    }

    // Hours ago
    if (diffHours < 24) {
        return `${diffHours}h ago`
    }

    // Yesterday
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)

    const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear()

    if (isYesterday) {
        return `Yesterday at ${date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        })}`
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString([], {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    // Fallback
    return date.toISOString().split("T")[0]
}
