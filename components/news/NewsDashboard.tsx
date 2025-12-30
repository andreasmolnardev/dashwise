"use client";

import { useConfig } from "@/context/ConfigContext";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faCaretDown, faEllipsisVertical } from "@fortawesome/free-solid-svg-icons";
import { Button } from "../ui/button";

interface Subscription {
    name: string;
    icon?: string;
}


export default function NewsDashboardComponent(
    children: React.PropsWithChildren<{}> = {}
) {
    const { config } = useConfig();
    const router = useRouter();

    const [feed, setFeed] = useState<Record<string, any[]> | null>(null);
    const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [limit, setLimit] = useState<Record<string, number>>({});

    // --- Auth redirect ---
    useEffect(() => {
        const token = localStorage.getItem("pb_token");
        if (!token) router.push("/auth/login");
    }, [router]);

    const token =
        typeof window !== "undefined"
            ? localStorage.getItem("pb_token")
            : null;

    if (!token) return null;

    // --- Prefetch manage page ---
    useEffect(() => {
        router.prefetch("/manage-feeds");
    }, [router]);

    // --- Fetch news ---
    useEffect(() => {
        async function load() {
            const res = await fetch("/api/v1/news", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) return;

            const data = await res.json();
            setFeed(data.feed);
            setSubscriptions(data.subscriptions);
        }

        load();
    }, [token]);

    // --- Toggles a category ---
    const toggleCategory = (cat: string) => {
        setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
        setLimit((prev) => ({
            ...prev,
            [cat]: prev[cat] ?? 10, // default 10
        }));
    };

    // --- Show more entries (10 at a time) ---
    const showMore = (cat: string) => {
        setLimit((prev) => ({
            ...prev,
            [cat]: (prev[cat] ?? 10) + 10,
        }));
    };


    const getIconUrl = (name) => {
        if (!subscriptions) {
            return "";
        }

        const subscription = subscriptions.find(s => s.name === name);

        if (subscription) {
            return subscription.icon ?? "";
        }
    }

    return (
        <div className="grid grid-rows-[36px_1fr_auto] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
            {/* HEADER */}
            <header className="flex gap-2 items-center px-3 md:px-6">
                <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
                <span className="font-semibold">News</span>
            </header>

            {/* MAIN */}
            <main
                id="page-content-container"
                className="
            flex gap-2
            overflow-x-auto snap-x snap-mandatory touch-pan-x scrollbar-hide
            md:overflow-visible md:snap-none
            px-3 md:px-6
        "
            >
                {/* LEFT PANEL */}
                <div
                    className="
                w-screen md:w-auto flex-grow snap-start
                space-y-3.5 overflow-y-auto min-w-0
            "
                >
                    <section className="space-y-3.5">
                        {!feed && (
                            <div className="opacity-60">Loading news…</div>
                        )}

                        {feed &&
                            Object.entries(feed).map(([category, articles]) => (
                                <div
                                    key={category}
                                    className="p-3 rounded-xl bg-(--surface-2) w-full"
                                >
                                    {/* Category header */}
                                    <button
                                        onClick={() => toggleCategory(category)}
                                        className="w-full flex justify-between items-center font-semibold text-base md:text-lg py-1 px-3"
                                    >
                                        <span>{category}</span>
                                        <span>
                                            {expanded[category]
                                                ? "– Collapse"
                                                : "+ Expand"}
                                        </span>
                                    </button>

                                    {/* Articles list */}
                                    {expanded[category] && (
                                        <div className="space-y-1.5 mt-2">
                                            {articles
                                                .slice(0, limit[category] ?? 10)
                                                .map((item, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="p-3 rounded-lg bg-(--surface-3) grid gap-3 grid-cols-1 md:grid-cols-[1fr_3fr]"
                                                    >
                                                        {item.thumbnailUrl ? (
                                                            <img
                                                                src={item.thumbnailUrl}
                                                                className="w-full aspect-[1.5/1] object-cover rounded-xl"
                                                            />
                                                        ) : (
                                                            <div
                                                                className="w-full aspect-[1.5/1] frosted rounded-xl"
                                                            />
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

                                                            {item.source && (
                                                                <div className="flex justify-between text-xs mt-1 opacity-80">
                                                                    <p className="flex items-center gap-1 ">
                                                                        {getIconUrl(item.source) && (
                                                                            <img
                                                                                src={getIconUrl(item.source)}
                                                                                alt={item.source}
                                                                                className="h-4"
                                                                            />
                                                                        )}
                                                                        {item.source}
                                                                        {item.author && ` • ${item.author}`}
                                                                    </p>
                                                                    <p> {formatRelativeTime(item.pubDate)}</p>
                                                                </div>
                                                            )}

                                                            {item.description && (
                                                                <p className="text-sm md:text-[0.95rem] opacity-80 line-clamp-2 mt-1">
                                                                    {item.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}

                                            {/* Show more */}
                                            {limit[category] < articles.length && (
                                                <div className="flex justify-center">
                                                    <Button
                                                        onClick={() => showMore(category)}
                                                        variant="ghost"
                                                        className="text-base md:text-lg"
                                                    >
                                                        <FontAwesomeIcon icon={faCaretDown} /> Show 10 more
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
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

                <Link
                    href="/news/manage-feeds"
                    className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm"
                >
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                    Manage subscriptions
                </Link>
            </footer>
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
