"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import {
    deleteNewsSavedArticleListAction,
    getNewsFeedsAction,
    getNewsSavedArticlesAction,
    getNewsSubscriptionsAction,
    renameNewsSavedArticleListAction,
} from '@/lib/apiClient';
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";

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
    icon?: string;
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
    const { token, user, updateUserProperty } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { feedId } = useParams();
    const queryClient = useQueryClient();
    const activeSavedList = feedId?.startsWith("saved-") ? decodeURIComponent(feedId.slice("saved-".length)) : null;

    const subscriptionsQuery = useQuery({
        queryKey: queryKeys.news.subscriptions(token),
        enabled: Boolean(token),
        queryFn: () => getNewsSubscriptionsAction({ token }),
    });
    const feedsQuery = useQuery({
        queryKey: queryKeys.news.feeds(token),
        enabled: Boolean(token),
        queryFn: () => getNewsFeedsAction({ token }),
    });
    const savedArticlesQuery = useQuery({
        queryKey: queryKeys.news.savedArticles(token, activeSavedList),
        enabled: Boolean(token),
        queryFn: () => getNewsSavedArticlesAction({ token }, activeSavedList),
    });
    const subscriptions = useMemo(
        () => (subscriptionsQuery.data?.subscriptions ?? []) as Subscription[],
        [subscriptionsQuery.data],
    );
    const feeds = useMemo(
        () => (feedsQuery.data?.feeds ?? []) as FeedRecord[],
        [feedsQuery.data],
    );
    const savedLists = useMemo(
        () => (savedArticlesQuery.data?.lists ?? []) as SavedListRecord[],
        [savedArticlesQuery.data],
    );
    const savedArticles = useMemo(
        () => (savedArticlesQuery.data?.articles ?? []) as SavedArticleRecord[],
        [savedArticlesQuery.data],
    );

    const reloadSidebar = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ["news"] });
    }, [queryClient]);

    useEffect(() => {
        const refreshSidebar = () => reloadSidebar();
        window.addEventListener("dashwise:news-sidebar-refresh", refreshSidebar);

        return () => {
            window.removeEventListener("dashwise:news-sidebar-refresh", refreshSidebar);
        };
    }, [reloadSidebar]);

    const deleteSavedListMutation = useMutation({
        mutationFn: (listId: string) => deleteNewsSavedArticleListAction({ token }, listId),
        onSuccess: reloadSidebar,
    });
    const renameSavedListMutation = useMutation({
        mutationFn: ({ listId, name }: { listId: string; name: string }) => renameNewsSavedArticleListAction({ token }, listId, name),
        onSuccess: reloadSidebar,
    });

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

                if (!feedId || feedId === "all" || feedId === "overview") return true;
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

    const activeFeedRoute = feedId && feedId !== "overview" ? `/apps/news/${feedId}` : "/apps/news";

    const defaultNewsPage = (() => {
        const value = user?.newsPreferences;
        if (!value || typeof value !== "object") return null;

        const page = (value as Record<string, unknown>).defaultNewsPage;
        return typeof page === "string" && (page === "/apps/news" || page.startsWith("/apps/news/"))
            ? page
            : null;
    })();

    const setDefaultNewsPage = (page: string | null) => {
        if (!token) return;

        const value = user?.newsPreferences;
        const currentPreferences = value && typeof value === "object"
            ? value as Record<string, unknown>
            : {};

        const nextPreferences = { ...currentPreferences };
        if (page) nextPreferences.defaultNewsPage = page;
        else delete nextPreferences.defaultNewsPage;

        void updateUserProperty("newsPreferences", nextPreferences).catch((error) => {
            console.error("Failed to set default news page", error);
        });
    };

    const defaultPageAction = (page: string) => {
        const isDefault = defaultNewsPage === page;

        return {
            label: isDefault ? "Remove as default news page" : "Set as default news page",
            icon: isDefault ? "fa6-solid:xmark" : "fa6-solid:thumbtack",
            action: () => setDefaultNewsPage(isDefault ? null : page),
        };
    };

    useEffect(() => {
        if (
            feedId ||
            location.pathname !== "/apps/news" ||
            location.search ||
            !defaultNewsPage ||
            defaultNewsPage === "/apps/news"
        ) {
            return;
        }

        navigate(defaultNewsPage, { replace: true });
    }, [defaultNewsPage, feedId, location.pathname, location.search, navigate]);

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

        await deleteSavedListMutation.mutateAsync(list.id);

        if (activeSavedList === list.id || activeSavedList === list.name) {
            navigate("/apps/news");
        }
    };

    const renameSavedList = async (list: SavedListRecord) => {
        if (!token) return;

        const name = window.prompt("Rename saved list", list.name)?.trim();
        if (!name || name === list.name) return;

        await renameSavedListMutation.mutateAsync({ listId: list.id, name });
    };

    return (
        <NewsSidebarContext.Provider value={{ subscriptions, feeds, reloadSidebar }}>
        <AppTemplate title="News">
            <Sidebar>

                <Tab
                  dst="/apps/news/overview"
                  icon="fa6-solid:layer-group"
                  title="Overview"
                  isRoot={true}
                  dropdownActions={[defaultPageAction("/apps/news/overview")]}
            />
            
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
                    icon={feeds.find((feed) => feed.id === "all")?.icon || "fa6-solid:newspaper"}
                    title="All"
                    group="Feeds"
                    isRoot={true}
                    dropdownActions={[
                        defaultPageAction("/apps/news"),
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
                        icon={feed.icon || "solar:document-text-bold"}
                        title={feed.title || "Untitled feed"}
                        group="Feeds"
                        dropdownActions={[
                            defaultPageAction(`/apps/news/${feed.id}`),
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
                            defaultPageAction(`/apps/news/saved-${encodeURIComponent(list.id)}`),
                            {
                                label: "Rename",
                                icon: "fa6-solid:pen-to-square",
                                action: () => renameSavedList(list),
                            },
                            {
                                label: "Delete",
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
                        icon={subscription.fetchErrors?.trim()
                            ? "fa6-solid:triangle-exclamation"
                            : subscription.icon
                                ? `url:${subscription.icon}`
                                : "fa6-solid:rss"}
                        fallbackIcon="fa6-solid:rss"
                        title={subscription.title || subscription.url}
                        group="Subscriptions"
                        hasError={Boolean(subscription.fetchErrors?.trim())}
                        dropdownActions={[
                            defaultPageAction(`/apps/news/${encodeSubscriptionRouteId(subscription)}`),
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
