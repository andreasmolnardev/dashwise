import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import SubscriptionDetailsForm from "./SubscriptionDetailsForm";
import {
    getNewsFeedMetadataAction,
    getNewsFeedsAction,
    getNewsSubscriptionsAction,
    subscribeNewsFeedAction,
    updateNewsFeedAction,
} from "@/lib/apiClient";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";
import type { NewsFeedDraft } from "@dashwise/types/sdk";

export default function NewsSubscriptionPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { token, withAuth } = useAuth();
    const queryClient = useQueryClient();
    const [feeds, setFeeds] = useState<{ id: string; title: string }[]>([]);
    const [existingSubscription, setExistingSubscription] = useState<NewsFeedDraft | null>(null);
    const [saved, setSaved] = useState(false);
    const feedUrl = searchParams.get("feedUrl")?.trim() ?? "";
    const feedName = searchParams.get("feedName")?.trim() ?? "";

    const initialFeed = useMemo<NewsFeedDraft | undefined>(() => feedUrl
        ? { feedUrl, name: feedName || feedUrl }
        : undefined, [feedName, feedUrl]);

    useEffect(() => {
        if (!token) {
            navigate("/auth/login", { replace: true });
            return;
        }

        let cancelled = false;
        void Promise.all([
            withAuth((auth) => getNewsFeedsAction(auth)),
            withAuth((auth) => getNewsSubscriptionsAction(auth)),
            feedUrl
                ? withAuth((auth) => getNewsFeedMetadataAction(auth, feedUrl)).catch(() => null)
                : Promise.resolve(null),
        ]).then(([feedResponse, subscriptionResponse, metadata]) => {
            if (cancelled) return;
            setFeeds((feedResponse.feeds ?? []).map((feed) => ({ id: feed.id, title: feed.title })));
            const normalizedTarget = normalizeUrl(metadata?.feedUrl || feedUrl);
            const existing = (subscriptionResponse.subscriptions ?? []).find((subscription) =>
                normalizeUrl(String(subscription.feedUrl ?? subscription.url ?? "")) === normalizedTarget
            );
            setExistingSubscription(existing
                ? {
                    ...existing,
                    feedUrl: String(existing.feedUrl ?? existing.url ?? feedUrl),
                    name: String(existing.name ?? existing.title ?? feedName ?? feedUrl),
                }
                : null);
        }).catch((error) => console.error("Failed to load news subscription data:", error));

        return () => { cancelled = true; };
    }, [feedName, feedUrl, navigate, token, withAuth]);

    const closePopup = () => {
        if (window.opener) window.close();
        else navigate("/apps/news", { replace: true });
    };

    if (!token) return null;

    return (
        <main className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-7">
            <section className="mx-auto w-full max-w-2xl rounded-xl border bg-card p-5 shadow-sm sm:p-7">
                <header className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">Dashwise News</p>
                        <h1 className="mt-1 text-xl font-semibold">
                            {saved ? "Subscription saved" : existingSubscription ? "Edit subscription" : "New subscription"}
                        </h1>
                    </div>
                    <Button type="button" variant="ghost" onClick={closePopup}>
                        {saved ? "Close" : "Cancel"}
                    </Button>
                </header>

                {saved ? (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {feedName || feedUrl || "The feed"} is now in your News subscriptions.
                        </p>
                        <Button type="button" onClick={closePopup}>Done</Button>
                    </div>
                ) : (
                    <SubscriptionDetailsForm
                        key={existingSubscription?.id || feedUrl || "new-subscription"}
                        feed={existingSubscription || initialFeed}
                        feeds={feeds}
                        resolveFeedMetadata={(url) => withAuth((auth) => getNewsFeedMetadataAction(auth, url))}
                        onClose={() => undefined}
                        onSave={async (feed) => {
                            const payload = {
                                feedUrl: String(feed.feedUrl ?? feed.url ?? "").trim(),
                                name: String(feed.name ?? feed.title ?? "").trim(),
                                icon: String(feed.icon ?? "").trim(),
                                feedIds: feed.feedIds ?? [],
                                newFeedTitles: feed.newFeedTitles ?? [],
                                linkReplaceRule: feed.linkReplaceRule,
                                fallbackThumbnailUrl: feed.fallbackThumbnailUrl,
                                thumbnailOverwriteUrl: feed.thumbnailOverwriteUrl,
                                similarityGroupingWordsBlacklist: feed.similarityGroupingWordsBlacklist,
                                enableTopicGrouping: feed.enableTopicGrouping !== false,
                            };
                            if (existingSubscription?.id) {
                                await withAuth((auth) => updateNewsFeedAction(auth, {
                                    subscriptionId: String(existingSubscription.id),
                                    ...payload,
                                    title: payload.name,
                                }));
                            } else {
                                await withAuth((auth) => subscribeNewsFeedAction(auth, payload));
                            }
                            setSaved(true);
                            await queryClient.invalidateQueries({ queryKey: queryKeys.news.subscriptions(token) });
                            await queryClient.invalidateQueries({ queryKey: queryKeys.news.feeds(token) });
                        }}
                    />
                )}
            </section>
        </main>
    );
}

function normalizeUrl(value: string) {
    try {
        const url = new URL(value);
        url.hash = "";
        return url.href.replace(/\/$/, "");
    } catch {
        return value.trim();
    }
}
