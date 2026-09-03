"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import { Button } from "../ui/button";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IconPickerComponent from "@/components/settings/IconPicker";
import NewsFeedEditModal from "./NewsFeedEditModal";
import SubscriptionDetailsForm from "./SubscriptionDetailsForm";
import { useNewsSidebarData } from "./NewsLayout";
import {
    createNewsFeedRecordAction,
    deleteNewsSavedArticleAction,
    getNewsFeedAction,
    getNewsFeedRecordAction,
    getNewsFeedMetadataAction,
    getNewsSubscriptionJsonAction,
    getNewsSavedArticlesAction,
    refreshNewsFeedAction,
    saveNewsArticleAction,
    subscribeNewsFeedAction,
    unsubscribeNewsFeedAction,
    updateNewsFeedAction,
    updateNewsFeedRecordAction,
    updateNewsSavedArticleReadStateAction,
    type NewsFeedPageResponse,
} from '@/lib/apiClient';
import type {
    NewsFeedDraft,
    NewsFeedItem,
    NewsFeedRecord,
    NewsFeedRecordUpdateInput,
    NewsSavedArticlesResponse,
} from "@dashwise/types/sdk";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

export default function NewsDashboardComponent() {
    const navigate = useNavigate();
    const { feedId } = useParams();
    const [searchParams] = useSearchParams();
    const activeFeedId = feedId || "all";
    const savedListRoutePrefix = "saved-";
    const activeSavedList = activeFeedId.startsWith(savedListRoutePrefix)
        ? decodeURIComponent(activeFeedId.slice(savedListRoutePrefix.length))
        : null;
    const sidebarAction = searchParams.get("action");
    const editSubscriptionRef = searchParams.get("subscription");
    const editFeedRef = searchParams.get("feed");

    const { subscriptions, feeds, reloadSidebar } = useNewsSidebarData();
    const [currentPage, setCurrentPage] = useState(1);
    const [addOpen, setAddOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<NewsFeedDraft | null>(null);
    const [editFeedOpen, setEditFeedOpen] = useState(false);
    const [editingNewsFeed, setEditingNewsFeed] = useState<NewsFeedRecord | null>(null);
    const [createFeedOpen, setCreateFeedOpen] = useState(false);
    const [newFeedTitle, setNewFeedTitle] = useState("");
    const [newFeedIcon, setNewFeedIcon] = useState("");
    const [createFeedIconPickerOpen, setCreateFeedIconPickerOpen] = useState(false);
    const [createFeedSaving, setCreateFeedSaving] = useState(false);
    const [createFeedError, setCreateFeedError] = useState<string | null>(null);
    const [loadingFeedRecord, setLoadingFeedRecord] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
    const [saveDialogArticle, setSaveDialogArticle] = useState<NewsFeedItem | null>(null);
    const [saveListSelection, setSaveListSelection] = useState("readLater");
    const [newSaveListName, setNewSaveListName] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);

    const itemsPerPage = 15;
    const { token, withAuth } = useAuth();
    const queryClient = useQueryClient();
    const feedQuery = useApiQuery<NewsFeedPageResponse | NewsSavedArticlesResponse>(
        activeSavedList
            ? queryKeys.news.savedArticles(token, activeSavedList)
            : queryKeys.news.feed(token, activeFeedId, currentPage),
        async (auth) => activeSavedList
            ? getNewsSavedArticlesAction(auth, activeSavedList)
            : getNewsFeedAction(auth, activeFeedId, itemsPerPage, (currentPage - 1) * itemsPerPage),
    );
    const allSavedArticlesQuery = useApiQuery<NewsSavedArticlesResponse>(
        queryKeys.news.savedArticles(token, null),
        (auth) => getNewsSavedArticlesAction(auth),
        { enabled: !activeSavedList },
    );

    const feedData = !activeSavedList && feedQuery.data && "items" in feedQuery.data
        ? feedQuery.data
        : undefined;
    const savedArticlesData = activeSavedList && feedQuery.data && "articles" in feedQuery.data
        ? feedQuery.data
        : !activeSavedList
            ? allSavedArticlesQuery.data
            : undefined;
    const feed = activeSavedList
        ? savedArticlesData?.articles.map((article) => article.json) ?? []
        : feedData?.items ?? [];
    const feedTotal = activeSavedList
        ? feed.length
        : feedData?.total ?? 0;

    const invalidateSavedArticles = async () => {
        if (!token) return;

        const rootKey = queryKeys.news.savedArticlesRoot(token);
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: rootKey }),
            queryClient.invalidateQueries({ queryKey: ["api", token, ...rootKey] }),
        ]);
    };

    const saveArticleMutation = useMutation({
        mutationFn: ({ article, list }: { article: NewsFeedItem; list?: string | null }) =>
            withAuth((auth) => saveNewsArticleAction(auth, article, list)),
        onSuccess: invalidateSavedArticles,
    });

    const deleteSavedArticleMutation = useMutation({
        mutationFn: (link: string) =>
            withAuth((auth) => deleteNewsSavedArticleAction(auth, link)),
        onSuccess: invalidateSavedArticles,
    });

    const markSavedArticleReadMutation = useMutation({
        mutationFn: (article: NewsFeedItem) => {
            const link = String(article.link || "").trim();
            return withAuth((auth) => updateNewsSavedArticleReadStateAction(auth, link, true));
        },
        onSuccess: async (_, article) => {
            if (!token || !activeSavedList) return;

            queryClient.setQueryData<NewsSavedArticlesResponse>(
                ["api", token, ...queryKeys.news.savedArticles(token, activeSavedList)],
                (current) => current
                    ? {
                        ...current,
                        articles: current.articles.map((savedArticle) =>
                            String(savedArticle.json?.link || "").trim() === String(article.link || "").trim()
                                ? { ...savedArticle, isRead: true }
                                : savedArticle
                        ),
                    }
                    : current,
            );
            await queryClient.invalidateQueries({
                queryKey: queryKeys.news.savedArticles(token, activeSavedList),
            });
        },
    });

    const subscribeFeedMutation = useMutation({
        mutationFn: (feed: NewsFeedDraft) =>
            withAuth((auth) => subscribeNewsFeedAction(auth, {
                feedUrl: String(feed.feedUrl ?? feed.url ?? ""),
                name: String(feed.name ?? feed.title ?? ""),
                icon: String(feed.icon ?? ""),
                feedIds: feed.feedIds ?? [],
                newFeedTitles: feed.newFeedTitles ?? [],
                linkReplaceRule: feed.linkReplaceRule,
                fallbackThumbnailUrl: feed.fallbackThumbnailUrl,
                thumbnailOverwriteUrl: feed.thumbnailOverwriteUrl,
                similarityGroupingWordsBlacklist: feed.similarityGroupingWordsBlacklist,
                enableTopicGrouping: feed.enableTopicGrouping !== false,
            })),
        onSuccess: async (_, feed) => {
            reloadSidebar();
            await refreshFeeds(
                String(feed.name ?? feed.title ?? feed.feedUrl ?? feed.url ?? "new feed"),
                feed.feedIds ?? [],
            );
        },
    });

    const unsubscribeFeedMutation = useMutation({
        mutationFn: (subscription: NewsFeedDraft) =>
            withAuth((auth) => unsubscribeNewsFeedAction(auth, String(subscription.id ?? subscription.url ?? ""))),
        onSuccess: async (_, subscription) => {
            reloadSidebar();
            await refreshFeeds(
                subscription.title || subscription.name || subscription.url || subscription.feedUrl || "feed",
                subscription.feedIds || [],
            );
        },
    });

    const updateFeedMutation = useMutation({
        mutationFn: ({ subscriptionId, feed }: { subscriptionId: string; feed: NewsFeedDraft }) =>
            withAuth((auth) => updateNewsFeedAction(auth, {
                subscriptionId,
                feedUrl: String(feed.feedUrl ?? feed.url ?? ""),
                title: String(feed.name ?? feed.title ?? ""),
                icon: String(feed.icon ?? ""),
                feedIds: feed.feedIds ?? [],
                linkReplaceRule: feed.linkReplaceRule,
                fallbackThumbnailUrl: feed.fallbackThumbnailUrl,
                thumbnailOverwriteUrl: feed.thumbnailOverwriteUrl,
                similarityGroupingWordsBlacklist: feed.similarityGroupingWordsBlacklist,
                enableTopicGrouping: feed.enableTopicGrouping !== false,
            })),
        onSuccess: async (_, { feed }) => {
            reloadSidebar();
            await refreshFeeds(
                String(feed.name ?? feed.title ?? feed.feedUrl ?? feed.url ?? "feed"),
                feed.feedIds ?? [],
            );
        },
    });

    const refreshFeedMutation = useMutation({
        mutationFn: (targetFeedIds: string[]) =>
            withAuth((auth) => refreshNewsFeedAction(auth, targetFeedIds)),
        onSuccess: async () => {
            if (!token) return;

            await queryClient.invalidateQueries({
                queryKey: ["api", token, ...queryKeys.news.feedRoot(token)],
            });
        },
    });

    const createFeedMutation = useMutation({
        mutationFn: (payload: { title: string; icon?: string }) =>
            withAuth((auth) => createNewsFeedRecordAction(auth, payload)),
        onSuccess: reloadSidebar,
    });

    const updateFeedRecordMutation = useMutation({
        mutationFn: (payload: NewsFeedRecordUpdateInput) =>
            withAuth((auth) => updateNewsFeedRecordAction(auth, payload)),
        onSuccess: reloadSidebar,
    });

    useEffect(() => {
        if (activeSavedList || !token || !feedData) return;

        const totalPages = Math.ceil(feedData.total / itemsPerPage);
        const nextPage = currentPage + 1;
        if (nextPage > totalPages) return;

        void queryClient.prefetchQuery({
            queryKey: [
                "api",
                token,
                ...queryKeys.news.feed(token, activeFeedId, nextPage),
            ],
            queryFn: () => withAuth((auth) =>
                getNewsFeedAction(
                    auth,
                    activeFeedId,
                    itemsPerPage,
                    (nextPage - 1) * itemsPerPage,
                )
            ),
        });
    }, [
        activeFeedId,
        activeSavedList,
        currentPage,
        feedData,
        queryClient,
        token,
        withAuth,
    ]);

    // --- Auth redirect ---
    useEffect(() => {
        if (!token) navigate("/auth/login");
    }, [navigate, token]);

    if (!token) return null;

    // --- Fetch news ---
    useEffect(() => {
        setCurrentPage(1);
    }, [activeFeedId]);

    useEffect(() => {
        if (!sidebarAction) return;

        if (sidebarAction === "subscribe") {
            setEditingFeed(null);
            setAddOpen(true);
            navigate(
                `/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`
                    .replace(/\/$/, ""),
                { replace: true },
            );
            return;
        }

        if (sidebarAction === "create-feed") {
            setCreateFeedOpen(true);
            setNewFeedTitle("");
            setNewFeedIcon("");
            setCreateFeedIconPickerOpen(false);
            setCreateFeedError(null);
            navigate(
                `/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`
                    .replace(/\/$/, ""),
                { replace: true },
            );
            return;
        }

        if (
            sidebarAction === "edit" && editSubscriptionRef &&
            subscriptions?.length
        ) {
            const target = subscriptions.find((subscription) =>
                subscription.id === editSubscriptionRef ||
                subscription.url === editSubscriptionRef
            );

            if (target) {
                setEditingFeed(target);
                setAddOpen(true);

                void withAuth((auth) => getNewsSubscriptionJsonAction(auth, String(target.id)))
                    .then((feedJson) => {
                        setEditingFeed((current) => current?.id === target.id
                            ? { ...current, json: feedJson.json }
                            : current);
                    })
                    .catch((err) => {
                        console.error("Failed to load subscription feed JSON:", err);
                    });
            }
            navigate(
                `/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`
                    .replace(/\/$/, ""),
                { replace: true },
            );
        }
    }, [
        sidebarAction,
        editSubscriptionRef,
        subscriptions,
        activeFeedId,
        navigate,
    ]);

    useEffect(() => {
        if (sidebarAction !== "edit-feed" || !editFeedRef) {
            setEditFeedOpen(false);
            setEditingNewsFeed(null);
            setLoadingFeedRecord(false);
            return;
        }

        let mounted = true;
        setEditFeedOpen(true);
        setLoadingFeedRecord(true);

        const feedSummary = feeds.find((entry) => entry.id === editFeedRef);
        const derivedSubscriptionRefs = editFeedRef === "all"
            ? []
            : (subscriptions ?? [])
                .filter((subscription) => subscription.id && subscription.feedIds?.includes(editFeedRef))
                .map((subscription) => String(subscription.id))
                .filter(Boolean);

        const fallbackRecord: NewsFeedRecord = {
            id: editFeedRef,
            title: feedSummary?.title || (editFeedRef === "all" ? "All feed" : "Untitled feed"),
            subscriptionRefs: derivedSubscriptionRefs,
            includedFeedRefs: feedSummary?.includedFeedRefs ?? [],
            excludedSubscriptionRefs: [],
        };

        if (editFeedRef !== "all") {
            setEditingNewsFeed(fallbackRecord);
            setLoadingFeedRecord(false);
            return;
        }

        withAuth((auth) => getNewsFeedRecordAction(auth, editFeedRef))
            .then((record) => {
                if (!mounted) return;
                setEditingNewsFeed(record || fallbackRecord);
            })
            .catch((err) => {
                console.error("Failed to load feed record:", err);
                if (mounted) {
                    setEditingNewsFeed(fallbackRecord);
                }
            })
            .finally(() => {
                if (mounted) {
                    setLoadingFeedRecord(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [sidebarAction, editFeedRef, feeds, subscriptions, withAuth]);

    const closeFeedEditor = () => {
        navigate(`/apps/news/${activeFeedId === "all" ? "" : activeFeedId}`.replace(/\/$/, ""), { replace: true });
        setEditFeedOpen(false);
        setEditingNewsFeed(null);
        setLoadingFeedRecord(false);
    };

    const closeCreateFeedModal = () => {
        setCreateFeedOpen(false);
        setNewFeedTitle("");
        setNewFeedIcon("");
        setCreateFeedIconPickerOpen(false);
        setCreateFeedError(null);
    };

    const handleCreateFeed = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const title = newFeedTitle.trim();

        if (!title) {
            setCreateFeedError("Feed name is required");
            return;
        }

        setCreateFeedSaving(true);
        setCreateFeedError(null);

        try {
            const createdFeed = await createFeedMutation.mutateAsync({ title, icon: newFeedIcon });
            closeCreateFeedModal();

            if (createdFeed?.id) {
                navigate(`/apps/news/${createdFeed.id}`);
            }
        } catch (err) {
            setCreateFeedError(err instanceof Error ? err.message : String(err));
        } finally {
            setCreateFeedSaving(false);
        }
    };

    const currentSubscription = subscriptions?.find((subscription) =>
        subscription.id === activeFeedId || subscription.url === activeFeedId
    ) ?? null;

    const openCurrentSubscriptionEditor = () => {
        if (!currentSubscription) return;

        setEditingFeed(currentSubscription);
        setAddOpen(true);
    };

    const openNewSubscription = () => {
        setEditingFeed(null);
        setAddOpen(true);
    };

    const getRefreshTargetFeedIds = (explicitFeedIds?: string[]) => {
        if (explicitFeedIds && explicitFeedIds.length > 0) {
            return explicitFeedIds.map(String).filter(Boolean);
        }

        if (activeFeedId === "all") {
            return feeds.map((entry) => entry.id).filter(Boolean);
        }

        return [activeFeedId].filter(Boolean);
    };

    const refreshFeeds = async (
        targetLabel: string = "current feed",
        explicitFeedIds?: string[],
    ) => {
        if (!token) return;
        const targetFeedIds = getRefreshTargetFeedIds(explicitFeedIds);
        if (!targetFeedIds.length) {
            return;
        }

        setIsRefreshing(true);
        setRefreshStatus(`Refreshing ${targetLabel}…`);
        try {
            await refreshFeedMutation.mutateAsync(targetFeedIds);
            setRefreshStatus("Fetching latest articles…");
            await feedQuery.refetch();
        } catch (err) {
            console.error("Refresh failed:", err);
        } finally {
            setIsRefreshing(false);
            setRefreshStatus(null);
        }
    };

    const subscribeFeed = (feed: NewsFeedDraft) => subscribeFeedMutation.mutateAsync(feed);

    const unsubscribeFeed = (subscription: NewsFeedDraft) => unsubscribeFeedMutation.mutateAsync(subscription);

    const updateFeed = (subscriptionId: string, feed: NewsFeedDraft) =>
        updateFeedMutation.mutateAsync({ subscriptionId, feed });

    // --- Scroll to top on page change ---
    useEffect(() => {
        const container = document.getElementById("news-scroll-container");
        if (container) {
            container.scrollTo({ top: 0, behavior: "smooth" });
        }
    }, [currentPage, activeFeedId]);

    const selectedSubscription = currentSubscription;

    const selectedFeed = feeds.find((entry) => entry.id === activeFeedId) ||
        null;

    const newSubscriptionDefaults = activeFeedId === "all"
        ? undefined
        : ({ feedIds: [activeFeedId] } as NewsFeedDraft);

    const activeSavedListName = activeSavedList
        ? savedArticlesData?.lists?.find((list) => list.id === activeSavedList || list.name === activeSavedList)?.name || activeSavedList
        : null;

    const selectedSource = activeSavedListName || selectedSubscription?.title ||
        selectedSubscription?.url || selectedFeed?.title || null;
    const selectedCategory = activeFeedId === "all"
        ? "All"
        : activeSavedList
            ? "Saved"
        : selectedFeed?.title || "Feed";

    const getIconUrl = (name: string) => {
        if (!subscriptions) {
            return "";
        }

        const subscription = subscriptions.find((s) =>
            s.title === name || s.name === name || s.url === name ||
            s.feedUrl === name || s.id === name
        );

        if (subscription) {
            return subscription.icon ?? "";
        }
    };

    const isArticleSaved = (article: NewsFeedItem) => {
        const link = String(article?.link || "").trim();
        if (!link || !savedArticlesData?.articles?.length) {
            return false;
        }

        return savedArticlesData.articles.some((savedArticle) =>
            String(savedArticle.json?.link || "").trim() === link
        );
    };

    const getSavedArticle = (article: NewsFeedItem) => {
        const link = String(article?.link || "").trim();
        if (!link || !savedArticlesData?.articles?.length) {
            return null;
        }

        return savedArticlesData.articles.find((savedArticle) =>
            String(savedArticle.json?.link || "").trim() === link
        ) || null;
    };

    const saveArticle = (article: NewsFeedItem, list?: string | null) =>
        saveArticleMutation.mutateAsync({ article, list });

    const toggleSavedArticle = async (article: NewsFeedItem) => {
        const link = String(article?.link || "").trim();
        if (!link) return;

        if (isArticleSaved(article)) {
            await deleteSavedArticleMutation.mutateAsync(link);
            return;
        }

        await saveArticle(article);
    };

    const markSavedArticleRead = async (article: NewsFeedItem) => {
        if (!activeSavedList || getSavedArticle(article)?.isRead) return;

        await markSavedArticleReadMutation.mutateAsync(article);
    };

    const openSaveDialog = (article: NewsFeedItem) => {
        const defaultList = savedArticlesData?.defaultList || savedArticlesData?.lists?.[0]?.id || "readLater";
        setSaveDialogArticle(article);
        setSaveListSelection(defaultList);
        setNewSaveListName("");
        setSaveError(null);
    };

    const handleSaveDialogSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!saveDialogArticle) return;

        const targetList = newSaveListName.trim() || saveListSelection;
        try {
            await saveArticle(saveDialogArticle, targetList);
            setSaveDialogArticle(null);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        }
    };

    const isPageLoading = feedQuery.isPending || !feedQuery.data;
    const visibleTotalPages = Math.ceil(feedTotal / itemsPerPage);

    const allArticles = [...feed].sort((a, b) =>
        new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    );

    const paginatedArticles = activeSavedList
        ? allArticles.slice(
            (currentPage - 1) * itemsPerPage,
            currentPage * itemsPerPage,
        )
        : allArticles;

    const subscriptionFetchError = !activeSavedList
        ? selectedSubscription?.fetchErrors?.trim()
        : undefined;

    const handlePageChange = (page: number) => {
        if (page === currentPage) return;
        setCurrentPage(page);
    };

    return (
        <div className="grid grid-rows-[auto_auto_1fr_auto] min-h-0 h-dvh p-0 overflow-hidden text-(--surface-foreground) bg-(--surface)">
            {/* HEADER */}
            <header className="flex items-center justify-between gap-2 pb-4">
                <h2 className="font-semibold text-lg md:text-3xl truncate ">
                    {selectedSource || selectedCategory || "All feed"}
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={openNewSubscription}
                        disabled={isRefreshing}
                        className={`
                            flex items-center justify-center h-9 w-9 rounded-full frosted gap-2
                            transition-all duration-300 hover:bg-white/10 px-2
                            ${isRefreshing ? "opacity-50" : "opacity-80 hover:opacity-100"}
                        `}
                        title="Add subscription"
                    >
                        <Icon icon="fa6-solid:plus" />
                        <span className="sr-only">Add subscription</span>
                    </button>
                    <button
                        onClick={openCurrentSubscriptionEditor}
                        disabled={!currentSubscription || isRefreshing}
                        className={`
                            flex items-center justify-center h-9 w-9 rounded-full frosted gap-2
                            transition-all duration-300 hover:bg-white/10 px-2
                            ${!currentSubscription || isRefreshing ? "opacity-50" : "opacity-80 hover:opacity-100"}
                        `}
                        title={currentSubscription ? "Edit subscription" : "No subscription to edit"}
                    >
                        <Icon icon="fa6-solid:pen-to-square" />
                    </button>
                    <button
                        onClick={() => refreshFeeds()}
                        disabled={isRefreshing}
                        className={`
                            flex items-center justify-center h-9 w-9 rounded-full frosted gap-2
                            transition-all duration-300 hover:bg-white/10 px-2
                            ${
                            isRefreshing
                                ? "opacity-50"
                                : "opacity-80 hover:opacity-100"
                        }
                        `}
                        title="Refresh all feeds"
                    >
                        <Icon
                            icon="fa6-solid:arrows-rotate"
                            className={`${isRefreshing ? "animate-spin" : ""}`}
                        />
                    </button>
                </div>
            </header>

            {/* MAIN */}
            <main
                id="page-content-container"
                className="
            flex flex-col md:flex-row gap-2 min-h-0 rounded-2xl w-full min-w-0
        "
            >
                {/* NEWS PANEL */}
                <div
                    id="news-scroll-container"
                    className="
                w-full md:w-auto grow
                space-y-3.5 overflow-y-auto min-w-0
            "
                >
                    <section className="space-y-3.5 pb-10">
                        {isPageLoading && (
                            <div className="opacity-60">Loading news…</div>
                        )}

                        {!isPageLoading && subscriptionFetchError && (
                            <NewsSubscriptionErrorCard
                                subscriptionName={selectedSubscription?.title || selectedSubscription?.url}
                                error={subscriptionFetchError}
                            />
                        )}

                        {!isPageLoading && !subscriptionFetchError &&
                            paginatedArticles.map((item, idx) => (
                                <NewsTopicGroup
                                    key={String(item.link || idx)}
                                    item={item}
                                    getIconUrl={getIconUrl}
                                    activeSavedList={activeSavedList}
                                    isArticleSaved={isArticleSaved}
                                    getSavedArticle={getSavedArticle}
                                    toggleSavedArticle={toggleSavedArticle}
                                    markSavedArticleRead={markSavedArticleRead}
                                    openSaveDialog={openSaveDialog}
                                />
                            ))}

                        {!isPageLoading && !subscriptionFetchError && activeSavedList && paginatedArticles.length === 0 && (
                            <div className="opacity-60">No saved articles in this list</div>
                        )}

                        {/* Pagination */}
                        {!isPageLoading && !subscriptionFetchError && visibleTotalPages > 1 && (
                            <div className="py-8">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <PaginationPrevious
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    if (currentPage > 1) {
                                                        handlePageChange(currentPage - 1);
                                                    }
                                                }}
                                                className={currentPage === 1
                                                    ? "pointer-events-none opacity-50"
                                                    : "cursor-pointer"}
                                            />
                                        </PaginationItem>

                                        {Array.from(
                                            { length: visibleTotalPages },
                                            (_, i) => i + 1,
                                        ).map((page) => {
                                            // Logic to show limited page numbers with ellipsis
                                            if (
                                                page === 1 ||
                                                page === visibleTotalPages ||
                                                (page >= currentPage - 1 &&
                                                    page <= currentPage + 1)
                                            ) {
                                                return (
                                                    <PaginationItem key={page}>
                                                        <PaginationLink
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                handlePageChange(page);
                                                            }}
                                                            isActive={currentPage ===
                                                                page}
                                                            className="cursor-pointer"
                                                        >
                                                            {page}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                );
                                            } else if (
                                                page === currentPage - 2 ||
                                                page === currentPage + 2
                                            ) {
                                                return (
                                                    <PaginationItem key={page}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                );
                                            }
                                            return null;
                                        })}

                                        <PaginationItem>
                                            <PaginationNext
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    if (
                                                        currentPage < visibleTotalPages
                                                    ) {
                                                        handlePageChange(currentPage + 1);
                                                    }
                                                }}
                                                className={currentPage ===
                                                        visibleTotalPages
                                                    ? "pointer-events-none opacity-50"
                                                    : "cursor-pointer"}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {/* Subscription Details Dialog */}
            <Dialog
                open={addOpen}
                onOpenChange={(v) => {
                    setAddOpen(v);
                    if (!v) setEditingFeed(null);
                }}
            >
                <DialogContent className="frosted text-foreground max-h-[90vh] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {editingFeed
                                ? "Edit Subscription"
                                : "Add new Subscription"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="max-h-[calc(90vh-6rem)] overflow-y-auto pr-2">
                        <SubscriptionDetailsForm
                            feed={editingFeed
                                ? {
                                    id: editingFeed.id,
                                    feedUrl: String(editingFeed.feedUrl ?? editingFeed.url ?? ""),
                                    name: String(editingFeed.name ?? editingFeed.title ?? editingFeed.url ?? ""),
                                    icon: editingFeed.icon,
                                    feedIds: editingFeed.feedIds || [],
                                    linkReplaceRule: editingFeed.linkReplaceRule,
                                    fallbackThumbnailUrl: editingFeed.fallbackThumbnailUrl,
                                    thumbnailOverwriteUrl: editingFeed.thumbnailOverwriteUrl,
                                    similarityGroupingWordsBlacklist: editingFeed.similarityGroupingWordsBlacklist,
                                    enableTopicGrouping: editingFeed.enableTopicGrouping,
                                    json: editingFeed.json,
                                }
                                : newSubscriptionDefaults}
                            feeds={feeds}
                            resolveFeedMetadata={(feedUrl) =>
                                withAuth((auth) => getNewsFeedMetadataAction(auth, feedUrl))
                            }
                            onClose={() => {
                                setAddOpen(false);
                                setEditingFeed(null);
                            }}
                            onSave={async (feed: any) => {
                                try {
                                    if (editingFeed) {
                                        await updateFeed(
                                            String(editingFeed.id ?? editingFeed.url ?? ""),
                                            feed,
                                        );
                                    } else {
                                        await subscribeFeed(feed);
                                    }
                                    setAddOpen(false);
                                    setEditingFeed(null);
                                } catch (err) {
                                    console.error("Failed to save feed:", err);
                                }
                            }}
                            onDelete={async (feedId) => {
                                try {
                                    await unsubscribeFeed({ id: feedId } as any);
                                    setAddOpen(false);
                                    setEditingFeed(null);
                                } catch (err) {
                                    console.error("Failed to delete feed:", err);
                                }
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={createFeedOpen} onOpenChange={(open) => !open && closeCreateFeedModal()}>
                <DialogContent className="frosted text-foreground w-[min(92vw,28rem)]">
                    <DialogHeader>
                        <DialogTitle>Create feed</DialogTitle>
                        <DialogDescription>
                            Add a new feed group to organize subscriptions.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleCreateFeed} className="space-y-4">
                        <div>
                            <Label htmlFor="new-news-feed-title">Feed name</Label>
                            <div className="mt-1 flex items-center gap-2">
                                <Dialog open={createFeedIconPickerOpen} onOpenChange={setCreateFeedIconPickerOpen}>
                                    <DialogTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="frosted h-10 w-10 shrink-0 p-0"
                                            title="Pick feed icon"
                                            disabled={createFeedSaving}
                                        >
                                            <Icon icon={newFeedIcon || "solar:document-text-bold"} className="text-lg" />
                                            <span className="sr-only">Pick feed icon</span>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="frosted text-foreground w-[min(92vw,48rem)] max-w-none">
                                        <DialogHeader>
                                            <DialogTitle>Choose Feed Icon</DialogTitle>
                                        </DialogHeader>
                                        <IconPickerComponent
                                            initialSelection={{ url: newFeedIcon }}
                                            onSelect={(iconObj) => {
                                                setNewFeedIcon(iconObj.url ?? "");
                                                setCreateFeedIconPickerOpen(false);
                                            }}
                                        />
                                    </DialogContent>
                                </Dialog>
                                <Input
                                    id="new-news-feed-title"
                                    className="frosted min-w-0 flex-1"
                                    placeholder="Homelab"
                                    value={newFeedTitle}
                                    onChange={(event) => setNewFeedTitle(event.target.value)}
                                    disabled={createFeedSaving}
                                    autoFocus
                                />
                            </div>
                        </div>

                        {createFeedError && (
                            <p className="text-sm text-red-400">{createFeedError}</p>
                        )}

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={closeCreateFeedModal}
                                disabled={createFeedSaving}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={createFeedSaving || !newFeedTitle.trim()}>
                                {createFeedSaving ? "Creating..." : "Create feed"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <NewsFeedEditModal
                open={editFeedOpen}
                feed={editingNewsFeed}
                loading={loadingFeedRecord}
                subscriptions={(subscriptions ?? [])
                    .filter((subscription) => subscription.id)
                    .map((subscription) => ({
                        id: String(subscription.id),
                        title: String(subscription.title || subscription.name || subscription.url || "Untitled subscription"),
                    }))}
                feeds={(feeds ?? [])
                    .filter((feed) => feed.id !== "all" && feed.id !== editFeedRef)
                    .map((feed) => ({
                        id: feed.id,
                        title: String(feed.title || "Untitled feed"),
                    }))}
                onClose={closeFeedEditor}
                onSave={async (payload) => {
                    await updateFeedRecordMutation.mutateAsync(payload);
                    setEditFeedOpen(false);
                    setEditingNewsFeed(null);
                }}
            />

            <Dialog open={Boolean(saveDialogArticle)} onOpenChange={(open) => !open && setSaveDialogArticle(null)}>
                <DialogContent className="frosted text-foreground w-[min(92vw,28rem)]">
                    <DialogHeader>
                        <DialogTitle>Save article</DialogTitle>
                        <DialogDescription>Select an existing list or create a new one.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveDialogSubmit} className="space-y-4">
                        <div>
                            <Label htmlFor="saved-news-list">List</Label>
                            <select
                                id="saved-news-list"
                                className="frosted mt-1 w-full rounded-md px-3 py-2"
                                value={saveListSelection}
                                onChange={(event) => setSaveListSelection(event.target.value)}
                            >
                                {(savedArticlesData?.lists?.length ? savedArticlesData.lists : [{ id: "readLater", name: "Read Later" }]).map((list) => (
                                    <option key={list.id} value={list.id}>{list.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <Label htmlFor="new-saved-news-list">New list</Label>
                            <Input
                                id="new-saved-news-list"
                                className="frosted mt-1"
                                placeholder="favorites"
                                value={newSaveListName}
                                onChange={(event) => setNewSaveListName(event.target.value)}
                            />
                        </div>
                        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="outline" onClick={() => setSaveDialogArticle(null)}>Cancel</Button>
                            <Button type="submit">Save</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            
        </div>
    );
}

function NewsSubscriptionErrorCard({ subscriptionName, error }: { subscriptionName?: string; error: string }) {
    return (
        <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-5 text-red-100"
        >
            <Icon icon="fa6-solid:triangle-exclamation" className="mt-0.5 shrink-0 text-lg text-red-300" />
            <div className="min-w-0 space-y-1">
                <h3 className="font-semibold">
                    Unable to load {subscriptionName || "this subscription"}
                </h3>
                <p className="break-words text-sm text-red-100/80">{error}</p>
            </div>
        </div>
    );
}

function NewsTopicGroup({ item, getIconUrl, activeSavedList, isArticleSaved, getSavedArticle, toggleSavedArticle, markSavedArticleRead, openSaveDialog }: {
    item: NewsFeedItem;
    getIconUrl: (name: string) => string | undefined;
    activeSavedList: string | null;
    isArticleSaved: (article: NewsFeedItem) => boolean;
    getSavedArticle: (article: NewsFeedItem) => { isRead?: boolean } | null;
    toggleSavedArticle: (article: NewsFeedItem) => Promise<void>;
    markSavedArticleRead: (article: NewsFeedItem) => Promise<void>;
    openSaveDialog: (article: NewsFeedItem) => void;
}) {
    const relatedArticles = Array.isArray(item.relatedArticles) ? item.relatedArticles : [];
    const savedArticle = getSavedArticle(item);

    return (
        <div className="space-y-2">
            <NewsArticle
                item={item}
                iconUrl={getIconUrl(item.subscription_id || item.subscription_name)}
                isSaved={isArticleSaved(item)}
                isUnread={Boolean(activeSavedList && savedArticle && !savedArticle.isRead)}
                onSave={() => toggleSavedArticle(item)}
                onSaveOptions={() => openSaveDialog(item)}
                onOpen={() => markSavedArticleRead(item)}
            />

            {relatedArticles.length > 0 && (
                <div className="mx-auto w-full rounded-xl bg-(--surface-2)/70 p-1 flex flex-col gap-1 font-medium">
                        Related
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {relatedArticles.map((article, idx) => (
                            <RelatedNewsArticle
                                key={String(article.link || idx)}
                                item={article}
                                iconUrl={getIconUrl(article.subscription_id || article.subscription_name)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function RelatedNewsArticle({ item, iconUrl }: { item: NewsFeedItem; iconUrl?: string }) {
    return (
        <a
            href={item.link}
            target="_blank"
            className="grid grid-cols-[5rem_1fr] gap-2 rounded-lg frosted p-2 transition hover:bg-white/10"
        >
            {item.thumbnailUrl
                ? (
                    <div className="overflow-hidden rounded-md shrink-0">
                        <img
                            src={String(item.thumbnailUrl)}
                            className="h-16 w-20 object-cover hover:scale-[1.1] transition-transform duration-200"
                        />
                    </div>
                )
                : <div className="h-16 w-20 rounded-md bg-white/5 shrink-0" />}
            <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary">
                    {item.title}
                </p>
                <div className="mt-1 flex items-center gap-1 text-xs opacity-70">
                    {iconUrl && <img src={iconUrl} alt={item.subscription_name} className="h-3.5" />}
                    <span className="truncate">{item.subscription_name}</span>
                </div>
            </div>
        </a>
    );
}

function NewsArticle({ item, iconUrl, isSaved, isUnread, onSave, onSaveOptions, onOpen }: { item: NewsFeedItem; iconUrl?: string; isSaved?: boolean; isUnread?: boolean; onSave?: () => void; onSaveOptions?: () => void; onOpen?: () => Promise<void> | void }) {
    return (
        <div className="rounded-xl bg-(--surface-2) w-full">
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_3fr]">
                <div className="relative overflow-hidden rounded-xl">
                {item.thumbnailUrl
                    ? (
                        <img
                            src={item.thumbnailUrl}
                            className="w-full h-45 object-cover hover:scale-[1.05] transition-transform duration-200"
                        />
                    )
                    : 
                    <div className="w-full h-45 frosted rounded-xl hover:border-primary" />}
                    <button
                        type="button"
                        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 frosted transition hover:bg-black/50 group"
                        title={isSaved ? "Saved to list" : "Save article"}
                        onClick={(event) => {
                            event.preventDefault();
                            onSave?.();
                        }}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            onSaveOptions?.();
                        }}
                    >
                        <Icon icon={isSaved ? "bi:bookmark-check-fill" : "fa6-solid:bookmark"} className={isSaved ? "text-(--primary)" : "text-white/90 group-hover:text-(--primary)"} />
                    </button>
                </div>

                <div className="min-w-0">
                    <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="
                font-semibold
                line-clamp-2
                text-base md:text-lg
                hover:text-primary
            "
                        onClick={async (event) => {
                            if (!isUnread || !item.link) return;

                            event.preventDefault();
                            try {
                                await onOpen?.();
                            } catch (error) {
                                console.error("Failed to mark saved article as read:", error);
                            }
                            window.open(item.link, "_blank", "noreferrer");
                        }}
                    >
                        <span className="inline-flex items-center gap-2">
                            <span>{item.title}</span>
                            {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-(--primary)" aria-label="Unread" />}
                        </span>
                    </a>

                    <div className="flex flex-wrap justify-between text-xs mt-1 opacity-80 gap-y-1">
                        <div className="flex items-center gap-1 flex-wrap">
                            {item.subscription_name && (
                                <span className="flex items-center gap-1">
                                    {iconUrl && (
                                        <img
                                            src={iconUrl}
                                            alt={item.subscription_name}
                                            className="h-4"
                                        />
                                    )}
                                    {item.subscription_name}
                                </span>
                            )}
                            {item.author && (
                                <span className="before:content-['•'] before:mx-1 opacity-60">
                                    {item.author}
                                </span>
                            )}
                        </div>
                        <p>{formatRelativeTime(item.pubDate)}</p>
                    </div>

                    {item.description && (
                        <p className="text-sm md:text-[0.95rem] opacity-80 line-clamp-2 mt-1">
                            {item.description}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export function formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();

    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Just now
    if (diffSeconds < 60) {
        return "Just now";
    }

    // Minutes ago
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    // Hours ago
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const isYesterday = date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
        return `Yesterday at ${
            date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
            })
        }`;
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString([], {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    // Fallback
    return date.toISOString().split("T")[0];
}
