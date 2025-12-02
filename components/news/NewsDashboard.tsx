"use client";

import { useConfig } from "@/context/ConfigContext";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import PagesTabs from "../PagesTabs";

export default function NewsDashboardComponent(
    children: React.PropsWithChildren<{}> = {}
) {
    const { config } = useConfig();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [feed, setFeed] = useState<Record<string, any[]> | null>(null);
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

    return (
        <div className="grid grid-rows-[1fr_36px] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
            <main
                id="page-content-container"
                className="
                    flex snap-x snap-mandatory overflow-x-auto touch-pan-x scrollbar-hide md:overflow-hidden
                    md:grid md:grid-cols-[2fr_1fr] gap-2
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
                                        className="w-full flex justify-between font-semibold text-lg py-1"
                                    >
                                        <span>{category}</span>
                                        <span>
                                            {expanded[category]
                                                ? "–"
                                                : "+"}
                                        </span>
                                    </button>

                                    {/* Articles list */}
                                    {expanded[category] && (
                                        <div className="mt-3 space-y-3">
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
                                                                className="w-20 h-20 object-cover rounded-2xl"
                                                            />
                                                        ) : (
                                                            <div className="frosted h-full rounded-2xl">
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
                                                                <p className="text-xs opacity-60 mt-1">
                                                                    {
                                                                        item.source
                                                                    }
                                                                </p>
                                                            )}

                                                            {item.summary && (
                                                                <p className="text-sm opacity-80 line-clamp-3 mt-1">
                                                                    {
                                                                        item.summary
                                                                    }
                                                                </p>
                                                            )}

                                                            {item.author && (
                                                                <p className="text-xs opacity-60 mt-1">
                                                                    by{" "}
                                                                    {
                                                                        item.author
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}

                                            {/* Show more button */}
                                            {limit[category] <
                                                articles.length && (
                                                    <button
                                                        onClick={() =>
                                                            showMore(category)
                                                        }
                                                        className="w-full py-2 text-sm rounded-lg bg-(--primary) text-white hover:opacity-90"
                                                    >
                                                        Show 10 more
                                                    </button>
                                                )}
                                        </div>
                                    )}
                                </div>
                            ))}
                    </section>
                </div>

                {/* RIGHT PANEL (empty for now) */}
                <div
                    id="right-news-panel"
                    className="flex-shrink-0 w-screen snap-start md:w-auto md:flex-grow space-y-3.5 overflow-y-auto min-w-0"
                    style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
                >
                    Right news panel here, empty for now
                </div>
            </main>

            {/* FOOTER */}
            <div className="grid grid-cols-[1fr_auto_180px] items-center" id="page-footer">
                <div id="app-details" className="flex items-center gap-2">
                    <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
                    <span className="font-semibold">News</span>

                    <Link
                        href="/"
                        className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm group"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} />
                        Back to dashboard
                    </Link>
                </div>

                <PagesTabs />

                <Link
                    href="/manage-feeds"
                    className="frosted flex gap-2 items-center p-1.5 rounded-full text-sm group"
                >
                    <FontAwesomeIcon icon={faArrowLeft} />
                    Manage subscriptions
                </Link>
            </div>
        </div>
    );
}
