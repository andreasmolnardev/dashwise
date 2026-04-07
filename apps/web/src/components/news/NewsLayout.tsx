"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { getNewsSubscriptionsAction } from "@/app/actions/news";
import { getNewsFeedsAction } from "@/app/actions/news";
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";

interface Subscription {
    id?: string;
    title?: string;
    url: string;
    icon?: string;
}

interface FeedRecord {
    id: string;
    title?: string;
}

export default function NewsLayout({ children }: { children: ReactNode }) {
    const { token, withAuth } = useAuth();
    const navigate = useNavigate();
    const { feedId } = useParams();
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [feeds, setFeeds] = useState<FeedRecord[]>([]);

    useEffect(() => {
        if (!token) {
            setSubscriptions([]);
            setFeeds([]);
            return;
        }

        let mounted = true;

        const loadSubscriptions = async () => {
            try {
                const [subscriptionsData, feedsData]: any[] = await Promise.all([
                    withAuth((auth) => getNewsSubscriptionsAction(auth)),
                    withAuth((auth) => getNewsFeedsAction(auth)),
                ]);

                if (!mounted) return;

                setSubscriptions(subscriptionsData?.subscriptions ?? []);
                setFeeds(Array.isArray(feedsData?.feeds) ? feedsData.feeds : []);
            } catch (error) {
                console.error("Failed to load news subscriptions:", error);
                if (mounted) {
                    setSubscriptions([]);
                    setFeeds([]);
                }
            }
        };

        loadSubscriptions();

        return () => {
            mounted = false;
        };
    }, [token, withAuth]);

    const userFeeds = useMemo(() => feeds.filter((entry) => entry.id && entry.id !== "all"), [feeds]);

    const subscriptionTabs = useMemo(
        () => subscriptions
            .slice()
            .sort((left, right) => String(left.title || left.url).localeCompare(String(right.title || right.url))),
        [subscriptions],
    );

    const encodeSubscriptionRouteId = (subscription: Subscription) => {
        return subscription.id || subscription.url;
    };

    const activeFeedRoute = feedId ? `/apps/news/${feedId}` : "/apps/news";

    const openSubscribeModal = () => {
        const params = new URLSearchParams({ action: "subscribe" });
        navigate(`${activeFeedRoute}?${params.toString()}`);
    };

    const openEditModal = (subscription: Subscription) => {
        const params = new URLSearchParams({
            action: "edit",
            subscription: subscription.id || subscription.url,
        });
        navigate(`${activeFeedRoute}?${params.toString()}`);
    };

    return (
        <AppTemplate title="News">
            <Sidebar>
                <GroupLabel
                    group="Feeds"
                    title="Feeds"
                    collapsible={true}
                />

                <Tab
                    dst="/apps/news"
                    icon="fa6-solid:newspaper"
                    title="All feed"
                    group="Feeds"
                />

                {userFeeds.map((feed) => (
                    <Tab
                        key={feed.id}
                        dst={`/apps/news/${feed.id}`}
                        icon="fa6-solid:layer-group"
                        title={feed.title || "Untitled feed"}
                        group="Feeds"
                    />
                ))}

                <GroupLabel
                    group="Subscriptions"
                    title="Subscriptions"
                    collapsible={true}
                    actions={[
                        {
                            icon: "fa6-solid:plus",
                            title: "Subscribe to feed",
                            action: openSubscribeModal,
                        },
                    ]}
                />

                {subscriptionTabs.map((subscription) => (
                    <Tab
                        key={subscription.id || subscription.url}
                        dst={`/apps/news/${encodeSubscriptionRouteId(subscription)}`}
                        icon="fa6-solid:rss"
                        title={subscription.title || subscription.url}
                        group="Subscriptions"
                        dropdownActions={[
                            {
                                label: "Edit",
                                icon: "fa6-solid:pen-to-square",
                                action: () => openEditModal(subscription),
                            },
                        ]}
                    />
                ))}
            </Sidebar>

            <Content>{children}</Content>
        </AppTemplate>
    );
}