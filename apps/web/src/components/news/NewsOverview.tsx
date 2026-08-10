"use client";

import { Icon } from "@iconify-icon/react";
import { useNavigate } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { useApiQuery } from "@/hooks/useApiQuery";
import { getNewsFeedAction } from "@/lib/apiClient";
import { queryKeys } from "@/lib/queryClient";
import type { NewsFeedItem } from "@dashwise/types/sdk";
import { useNewsSidebarData, type FeedRecord, type Subscription } from "./NewsLayout";
import { formatRelativeTime } from "./NewsDashboard";

const overviewArticleLimit = 12;

export default function NewsOverview() {
    const { token } = useAuth();
    const { feeds, subscriptions } = useNewsSidebarData();
    const overviewFeeds = feeds.filter((feed) => feed.id !== "all");
    const feedsToDisplay = overviewFeeds.length > 0 ? overviewFeeds : feeds.filter((feed) => feed.id === "all");

    return (
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-(--surface) text-(--surface-foreground)">
            <header className="flex items-center justify-between gap-3 pb-4">
              <h1 className="truncate text-xl font-semibold md:text-3xl">Overview</h1>
            </header>

            <main id="news-scroll-container" className="min-h-0 flex-1 overflow-y-auto pb-10">
                {!token && <div className="opacity-60">Loading news…</div>}

                {token && feedsToDisplay.length === 0 && (
                    <div className="rounded-2xl frosted p-8 text-center text-white/60">
                        Subscribe to a feed or create a feed group to see your news overview.
                    </div>
                )}

                <div className="space-y-7">
                    {feedsToDisplay.map((feed) => (
                        <NewsFeedCarousel key={feed.id} feed={feed} subscriptions={subscriptions} />
                    ))}
                </div>
            </main>
        </div>
    );
}

function NewsFeedCarousel({
    feed,
    subscriptions,
}: {
    feed: FeedRecord;
    subscriptions: Subscription[];
}) {
    const navigate = useNavigate();
    const { token } = useAuth();
    const feedQuery = useApiQuery(
        queryKeys.news.feed(token, feed.id, 1),
        (auth) => getNewsFeedAction(auth, feed.id, overviewArticleLimit),
        { staleTime: 60_000 },
    );
    const items = feedQuery.data?.items ?? [];
    const getIconUrl = (item: NewsFeedItem) => {
        const subscription = subscriptions.find((entry) =>
            String(entry.id || "") === String(item.subscription_id || "") ||
            String(entry.title || "") === String(item.subscription_name || "") ||
            String(entry.url || "") === String(item.subscription_name || ""),
        );

        return subscription?.icon;
    };

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 w-full">
                <button
                    type="button"
                    className="group w-full grid grid-cols-[1fr_auto] min-w-0 items-center gap-2 text-left"
                    onClick={() => navigate(`/apps/news/${feed.id}`)}
                >
                    <span className="truncate text-lg font-semibold group-hover:text-primary md:text-xl">
                        {feed.title || "Untitled feed"}
                    </span>
        
                    <Icon icon="fa6-solid:arrow-up-right-from-square" className="shrink-0 text-xs text-white/45" />
                </button>
            </div>

            {feedQuery.isLoading && <OverviewLoading />}
            {feedQuery.isError && <p className="text-sm text-white/50">Unable to load this feed.</p>}
            {!feedQuery.isLoading && !feedQuery.isError && items.length === 0 && (
                <p className="rounded-xl text-sm text-white/50">Feed is empty.</p>
            )}

            {items.length > 0 && (
                <div
                    className="flex snap-x gap-2.5 overflow-x-auto overscroll-x-contain pb-2"
                >
                    {items.map((item, index) => (
                        <OverviewTopicCard
                            key={`${item.link}-${index}`}
                            item={item}
                            iconUrl={getIconUrl(item)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function OverviewTopicCard({ item, iconUrl }: { item: NewsFeedItem; iconUrl?: string }) {
    const relatedArticles = Array.isArray(item.relatedArticles) ? item.relatedArticles : [];
    const description = typeof item.description === "string" ? item.description : "";

    return (
        <article className="flex w-[min(84vw,20rem)] shrink-0 snap-start flex-col overflow-hidden bg-(--surface-2)">
            <a href={item.link} target="_blank" rel="noreferrer" className="group block">
                <div className="relative h-40 mb-3 overflow-hidden">
                    {item.thumbnailUrl ? (
                        <img
                            src={String(item.thumbnailUrl)}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-200 rounded-xl group-hover:scale-[1.04]"
                        />
                    ) : (
                        <div className="h-full w-full frosted" />
                    )}
                    {item.topicTitle && (
                        <span className="absolute bottom-2 left-3 max-w-[calc(100%-1.5rem)] truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/70">
                            {item.topicTitle}
                        </span>
                    )}
                </div>
                <div className="space-y-1.5">
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug group-hover:text-primary">
                        {item.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-white/55">
                        {iconUrl && <img src={iconUrl} alt="" className="h-4 w-4 object-contain" />}
                        <span className="truncate">{item.subscription_name}</span>
                        <span className="shrink-0">· {formatRelativeTime(String(item.pubDate))}</span>
                    </div>
                    {description && <p className="line-clamp-2 text-sm leading-snug text-white/65">{description}</p>}
                </div>
            </a>

            {relatedArticles.length > 0 && (
                <div className="mt-auto border-t border-white/10 p-2.5">
                    <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
                        Similar articles
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                        {relatedArticles.map((article, index) => (
                            <a
                                key={`${article.link}-${index}`}
                                href={article.link}
                                target="_blank"
                                rel="noreferrer"
                                className="w-44 shrink-0 rounded-lg frosted p-2 transition hover:bg-white/10"
                            >
                                <p className="line-clamp-3 text-xs font-medium leading-snug">{article.title}</p>
                                <p className="mt-1 truncate text-[10px] text-white/45">{article.subscription_name}</p>
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
}

function OverviewLoading() {
    return (
        <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2].map((item) => (
                <div key={item} className="h-72 w-[min(84vw,27rem)] shrink-0 animate-pulse rounded-xl bg-white/5" />
            ))}
        </div>
    );
}
