"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import {
    deleteNewsSavedArticleListAction,
    getNewsFeedsAction,
    getNewsSavedArticlesAction,
    getNewsSubscriptionsAction,
} from '@/lib/apiClient';
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";

export interface Subscription {
    id?: string;
    title?: string;
    url: string;
    icon?: string;
    feedIds?: string[];
    fetchErrors?: string;
}

export interface FeedRecord {
    id: string;
    title?: string;
}

interface SavedListRecord {
    id: string;
    name: string;
}

interface SavedArticleRecord {
    json?: {
        subscription_id?: string;
        subscription_name?: string;
        link?: string;
    };
}

const fallbackSavedLists = [{ id: "readLater", name: "Read Later" }];

type NewsSidebarContextValue = {
    subscriptions: Subscription[];
    feeds: FeedRecord[];
    reloadSidebar: () => void;
};

const NewsSidebarContext = createContext<NewsSidebarContextValue | null>(null);

export function useNewsSidebarData() {
    const context = useContext(NewsSidebarContext);
    if (!context) throw new Error("useNewsSidebarData must be used inside NewsLayout");
    return context;
}

export default function NewsLayout({ children }: { children: ReactNode }) {
    const { token, withAuth } = useAuth();
    const navigate = useNavigate();
    const { feedId } = useParams();
    const [searchParams] = useSearchParams();
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [feeds, setFeeds] = useState<FeedRecord[]>([]);
    const [savedLists, setSavedLists] = useState<SavedListRecord[]>([]);
    const [savedArticles, setSavedArticles] = useState<SavedArticleRecord[]>([]);
    const [sidebarRefreshVersion, setSidebarRefreshVersion] = useState(0);
    const activeSavedList = feedId?.startsWith("saved-") ? decodeURIComponent(feedId.slice("saved-".length)) : null;

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

        const loadSubscriptions = async () => {
            try {
                const data = await withAuth((auth) => getNewsSubscriptionsAction(auth));
                if (mounted) setSubscriptions(data?.subscriptions ?? []);
            } catch (error) {
                console.error("Failed to load news subscriptions:", error);
                if (mounted) setSubscriptions([]);
            }
        };

        const loadFeeds = async () => {
            try {
                const data = await withAuth((auth) => getNewsFeedsAction(auth));
                if (mounted) setFeeds(Array.isArray(data?.feeds) ? data.feeds : []);
            } catch (error) {
                console.error("Failed to load news feeds:", error);
                if (mounted) setFeeds([]);
            }
        };

        void Promise.all([loadSubscriptions(), loadFeeds()]);

        return () => {
            mounted = false;
        };
    }, [token, withAuth, sidebarRefreshVersion]);

    useEffect(() => {
        if (!token) {
            setSavedLists([]);
            setSavedArticles([]);
            return;
        }

        let mounted = true;

        const loadSavedArticles = async () => {
            try {
                const savedData = await withAuth((auth) => getNewsSavedArticlesAction(auth, activeSavedList));

                if (!mounted) return;

                setSavedLists(Array.isArray(savedData?.lists) ? savedData.lists : fallbackSavedLists);
                setSavedArticles(Array.isArray(savedData?.articles) ? savedData.articles : []);
            } catch (error) {
                console.error("Failed to load news saved articles:", error);
                if (mounted) {
                    setSavedLists([]);
                    setSavedArticles([]);
                }
            }
        };

        loadSavedArticles();

        return () => {
            mounted = false;
        };
    }, [token, withAuth, sidebarRefreshVersion, activeSavedList]);

    const userFeeds = useMemo(() => feeds.filter((entry) => entry.id && entry.id !== "all"), [feeds]);
    const savedSubscriptionRefs = useMemo(() => {
        if (!activeSavedList) return null;

        return new Set(savedArticles.flatMap((article) => [
            article.json?.subscription_id,
            article.json?.subscription_name,
        ].map((value) => String(value || "").trim()).filter(Boolean)));
    }, [activeSavedList, savedArticles]);
    const subscriptionTabs = useMemo(
        () => subscriptions
            .slice()
            .filter((sub) => {
                if (savedSubscriptionRefs) {
                    return savedSubscriptionRefs.has(String(sub.id || "")) ||
                        savedSubscriptionRefs.has(String(sub.title || "")) ||
                        savedSubscriptionRefs.has(String(sub.url || ""));
                }

                if (!feedId || feedId === "all") return true;
                const isSelected = sub.id === feedId || sub.url === feedId;
                if (isSelected) return true;
                return Array.isArray(sub.feedIds) ? sub.feedIds.includes(feedId) : false;
            })
            .sort((left, right) => String(left.title || left.url).localeCompare(String(right.title || right.url))),
        [subscriptions, feedId, savedSubscriptionRefs],
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

    const deleteSavedList = async (list: SavedListRecord) => {
        if (!token) return;

        const confirmed = window.confirm(`Delete ${list.name} and all saved articles in it?`);
        if (!confirmed) return;

        await withAuth((auth) => deleteNewsSavedArticleListAction(auth, list.id));
        setSidebarRefreshVersion((version) => version + 1);

        if (activeSavedList === list.id || activeSavedList === list.name) {
            navigate("/apps/news");
        }
    };

    const reloadSidebar = () => setSidebarRefreshVersion((version) => version + 1);

    return (
        <NewsSidebarContext.Provider value={{ subscriptions, feeds, reloadSidebar }}>
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

                {(savedLists.length ? savedLists : fallbackSavedLists).map((list) => (
                    <Tab
                        key={list.id}
                        dst={`/apps/news/saved-${encodeURIComponent(list.id)}`}
                        icon="fa6-solid:bookmark"
                        title={list.name}
                        group="Saved"
                        dropdownActions={[
                            {
                                label: "Delete list",
                                icon: "fa6-solid:trash",
                                action: () => deleteSavedList(list),
                            },
                        ]}
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
                        hasError={Boolean(subscription.fetchErrors)}
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
        </NewsSidebarContext.Provider>
    );
}
