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
        <div className="grid grid-rows-[36px_1fr_36px] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
            <header className="flex gap-2 items-center">
                <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
                <span className="font-semibold">News</span>
            </header>
            <main
                id="page-content-container"
                className="
                    flex snap-x snap-mandatory overflow-x-auto touch-pan-x scrollbar-hide md:overflow-hidden
                    gap-2 px-25
                "
            >
                {/* LEFT PANEL */}
                <div className="flex-grow-1 w-screen snap-start md:w-auto md:flex-grow space-y-3.5 overflow-y-auto min-w-0">
                    <section>
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
                                        className="w-full flex justify-between font-semibold text-lg py-1 px-3"
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
                                        <div className="space-y-1.5">
                                            {articles
                                                .slice(0, limit[category] ?? 10)
                                                .map((item, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="p-3 rounded-lg bg-(--surface-3) grid grid-cols-[1fr_3fr] gap-3 h-32"
                                                    >

                                                        {/* Image */}
                                                        {item.thumbnailUrl ? (
                                                            <img
                                                                src={
                                                                    item.thumbnailUrl
                                                                }
                                                                className="my-2 h-30 object-cover rounded-xl self-center w-full max-w-52"
                                                            />
                                                        ) : (
                                                            <div className="my-2 h-30 frosted rounded-xl self-center">
                                                            </div>
                                                        )}

                                                        {/* Text */}
                                                        <div className="min-w-0">
                                                            <a
                                                                href={item.link}
                                                                target="_blank"
                                                                className="font-semibold line-clamp-2 hover:text-(--primary) text-lg"
                                                            >
                                                                {item.title}
                                                            </a>

                                                            {item.source && (
                                                                <p className="text-xs mt-1 flex items-center gap-1">
                                                                    {getIconUrl(item.source) && <img src={getIconUrl(item.source)} alt={item.source} className="h-4" />}
                                                                    {item.source + (item.author ? ` • ${item.author}` : "")}
                                                                </p>
                                                            )}

                                                            {item.description && (
                                                                <p className="text-sm opacity-80 line-clamp-2 mt-1">
                                                                    {
                                                                        item.description
                                                                    }
                                                                </p>
                                                            )}

                                                        </div>
                                                    </div>
                                                ))}

                                            {/* Show more button */}
                                            {limit[category] <
                                                articles.length && (
                                                    <div className="flex justify-center">
                                                        <Button
                                                            onClick={() =>
                                                                showMore(category)
                                                            }
                                                            variant="ghost"
                                                            className="text-lg"
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

                {/* RIGHT PANEL (empty for now)
                
                 <div
                    id="right-news-panel"
                    className="flex-shrink-0 w-screen snap-start md:w-auto md:flex-grow space-y-3.5 overflow-y-auto min-w-0"
                    style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
                >
                    Right news panel here, empty for now
                </div>
            */}

            </main>

            {/* FOOTER */}
            <div className="flex justify-between items-center" id="page-footer">
                <div id="app-details" className="flex items-center gap-2">
                    <Link
                        href="/home"
                        className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm group"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} />
                        Back to dashboard
                    </Link>
                </div>

                <Link
                    href="/news/manage-feeds"
                    className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm group"
                >
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                    Manage subscriptions
                </Link>
            </div>
        </div>
    );
}
