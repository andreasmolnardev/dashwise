"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import {
    deleteNewsSavedArticleListAction,
    getNewsFeedsAction,
    getNewsSavedArticlesAction,
    getNewsSubscriptionsAction,
    renameNewsSavedArticleListAction,
} from '@/lib/apiClient';
import { ModuleNavigation, type ModuleNavigationContribution } from "@/platform/navigation/ModuleNavigation";
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
    const { token } = useAuth();
    const navigate = useNavigate();
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
        <ModuleNavigation title="News" contributions={[
            { kind: "group", id: "feeds", group: "Feeds", collapsible: true, actions: [{ icon: "fa6-solid:plus", title: "Create feed", action: openCreateFeedModal }] },
            { kind: "item", id: "all", path: "/apps/news", icon: "fa6-solid:newspaper", label: "All", group: "Feeds", isRoot: true, dropdownActions: [{ label: "Edit feed", icon: "fa6-solid:pen-to-square", action: () => openEditFeedModal({ id: "all", title: "All feed" }) }] },
            ...userFeeds.map((feed): ModuleNavigationContribution => ({ kind: "item", id: `feed-${feed.id}`, path: `/apps/news/${feed.id}`, icon: "solar:document-text-bold", label: feed.title || "Untitled feed", group: "Feeds", dropdownActions: [{ label: "Edit feed", icon: "fa6-solid:pen-to-square", action: () => openEditFeedModal(feed) }] })),
            { kind: "group", id: "saved", group: "Saved", collapsible: true },
            ...(savedLists.length ? savedLists : fallbackSavedLists).map((list): ModuleNavigationContribution => ({ kind: "item", id: `saved-${list.id}`, path: `/apps/news/saved-${encodeURIComponent(list.id)}`, icon: "fa6-solid:bookmark", label: list.name, group: "Saved", dropdownActions: [{ label: "Rename", icon: "fa6-solid:pen-to-square", action: () => renameSavedList(list) }, { label: "Delete", icon: "fa6-solid:trash", action: () => deleteSavedList(list) }] })),
            { kind: "group", id: "subscriptions", group: "Subscriptions", collapsible: true, actions: [{ icon: "fa6-solid:plus", title: "Subscribe to feed", action: openSubscribeModal }] },
            ...subscriptionTabs.map((subscription): ModuleNavigationContribution => ({ kind: "item", id: `subscription-${subscription.id || subscription.url}`, path: `/apps/news/${encodeSubscriptionRouteId(subscription)}`, icon: subscription.icon ? `url:${subscription.icon}` : "fa6-solid:rss", fallbackIcon: "fa6-solid:rss", label: subscription.title || subscription.url, group: "Subscriptions", hasError: Boolean(subscription.fetchErrors), dropdownActions: [{ label: "Edit", icon: "fa6-solid:pen-to-square", action: () => openEditSubscriptionModal(subscription) }] })),
        ]}>
            {children}
        </ModuleNavigation>
        </NewsSidebarContext.Provider>
    );
}
