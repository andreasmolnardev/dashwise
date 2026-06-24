"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import {
    getNewsFeedsAction,
    getNewsSavedArticlesAction,
    getNewsSubscriptionsAction,
} from '@/lib/apiClient';
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";

interface Subscription {
    id?: string;
    title?: string;
    url: string;
    icon?: string;
    feedIds?: string[];
}

interface FeedRecord {
    id: string;
    title?: string;
}

export default function NewsLayout({ children }: { children: ReactNode }) {
    const { token, withAuth } = useAuth();
    const navigate = useNavigate();
    const { feedId } = useParams();
    const [searchParams] = useSearchParams();
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [feeds, setFeeds] = useState<FeedRecord[]>([]);
    const [savedLists, setSavedLists] = useState<string[]>([]);
    const [sidebarRefreshVersion, setSidebarRefreshVersion] = useState(0);

    useEffect(() => {
        const refreshSidebar = () => setSidebarRefreshVersion((version) => version + 1);
        window.addEventListener("dashwise:news-sidebar-refresh", refreshSidebar);

        return () => {
            window.removeEventListener("dashwise:news-sidebar-refresh", refreshSidebar);
        };
    }, []);

    useEffect(() => {
        if (!token) {
            setSubscriptions([]);
            setFeeds([]);
            return;
        }

        let mounted = true;

        const loadSidebarData = async () => {
            try {
                const [subscriptionsData, feedsData, savedData]: any[] = await Promise.all([
                    withAuth((auth) => getNewsSubscriptionsAction(auth)),
                    withAuth((auth) => getNewsFeedsAction(auth)),
                    withAuth((auth) => getNewsSavedArticlesAction(auth)),
                ]);

                if (!mounted) return;

                setSubscriptions(subscriptionsData?.subscriptions ?? []);
                setFeeds(Array.isArray(feedsData?.feeds) ? feedsData.feeds : []);
                setSavedLists(Array.isArray(savedData?.lists) ? savedData.lists : ["readLater"]);
            } catch (error) {
                console.error("Failed to load news subscriptions:", error);
                if (mounted) {
                    setSubscriptions([]);
                    setFeeds([]);
                    setSavedLists([]);
                }
            }
        };

        loadSidebarData();

        return () => {
            mounted = false;
        };
    }, [token, withAuth, sidebarRefreshVersion]);

    const userFeeds = useMemo(() => feeds.filter((entry) => entry.id && entry.id !== "all"), [feeds]);
    const subscriptionTabs = useMemo(
        () => subscriptions
            .slice()
            .filter((sub) => {
                if (!feedId || feedId === "all") return true;
                const isSelected = sub.id === feedId || sub.url === feedId;
                if (isSelected) return true;
                return Array.isArray(sub.feedIds) ? sub.feedIds.includes(feedId) : false;
            })
            .sort((left, right) => String(left.title || left.url).localeCompare(String(right.title || right.url))),
        [subscriptions, feedId],
    );

    const encodeSubscriptionRouteId = (subscription: Subscription) => {
        return subscription.id || subscription.url;
    };

    const activeFeedRoute = feedId ? `/apps/news/${feedId}` : "/apps/news";
    const sidebarAction = searchParams.get("action");
    const editFeedRef = searchParams.get("feed");

    const openSubscribeModal = () => {
        const params = new URLSearchParams({ action: "subscribe" });
        navigate(`${activeFeedRoute}?${params.toString()}`);
    };

    const openCreateFeedModal = () => {
        const params = new URLSearchParams({ action: "create-feed" });
        navigate(`${activeFeedRoute}?${params.toString()}`);
    };

    const openEditSubscriptionModal = (subscription: Subscription) => {
        const params = new URLSearchParams({
            action: "edit",
            subscription: subscription.id || subscription.url,
        });
        navigate(`${activeFeedRoute}?${params.toString()}`);
    };

    const openEditFeedModal = (feed: FeedRecord) => {
        const params = new URLSearchParams({
            action: "edit-feed",
            feed: feed.id,
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
                    actions={[
                        {
                            icon: "fa6-solid:plus",
                            title: "Create feed",
                            action: openCreateFeedModal,
                        },
                    ]}
                />

                <Tab
                    dst="/apps/news"
                    icon="fa6-solid:newspaper"
                    title="All"
                    group="Feeds"
                    isRoot={true}
                    dropdownActions={[
                        {
                            label: "Edit feed",
                            icon: "fa6-solid:pen-to-square",
                            action: () => openEditFeedModal({ id: "all", title: "All feed" }),
                        },
                    ]}
                />

                {userFeeds.map((feed) => (
                    <Tab
                        key={feed.id}
                        dst={`/apps/news/${feed.id}`}
                        icon="solar:document-text-bold"
                        title={feed.title || "Untitled feed"}
                        group="Feeds"
                        dropdownActions={[
                            {
                                label: "Edit feed",
                                icon: "fa6-solid:pen-to-square",
                                action: () => openEditFeedModal(feed),
                            },
                        ]}
                    />
                ))}

                <GroupLabel
                    group="Saved"
                    title="Saved"
                    collapsible={true}
                />

                {(savedLists.length ? savedLists : ["readLater"]).map((list) => (
                    <Tab
                        key={list}
                        dst={`/apps/news/saved-${encodeURIComponent(list)}`}
                        icon="fa6-solid:bookmark"
                        title={list}
                        group="Saved"
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
                        icon={subscription.icon ? `url:${subscription.icon}` : "fa6-solid:rss"}
                        fallbackIcon="fa6-solid:rss"
                        title={subscription.title || subscription.url}
                        group="Subscriptions"
                        dropdownActions={[
                            {
                                label: "Edit",
                                icon: "fa6-solid:pen-to-square",
                                action: () => openEditSubscriptionModal(subscription),
                            },
                        ]}
                    />
                ))}
            </Sidebar>

            <Content>
                <>
                {/** <PageTitle> here</PageTitle> here*/}
                {children}
                </>
            </Content>
        </AppTemplate>
    );
}
