"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@iconify-icon/react";
import type { NewsFeedRecord, NewsFeedRecordUpdateInput } from "@dashwise/types/sdk";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IconPickerComponent from "@/components/settings/IconPicker";

interface SubscriptionOption {
    id: string;
    title: string;
}

interface FeedOption {
    id: string;
    title: string;
}

interface NewsFeedEditModalProps {
    open: boolean;
    feed: NewsFeedRecord | null;
    subscriptions: SubscriptionOption[];
    feeds: FeedOption[];
    loading?: boolean;
    onClose: () => void | Promise<void>;
    onSave: (payload: NewsFeedRecordUpdateInput) => Promise<void> | void;
}

export default function NewsFeedEditModal({
    open,
    feed,
    subscriptions,
    feeds,
    loading = false,
    onClose,
    onSave,
}: NewsFeedEditModalProps) {
    const [title, setTitle] = useState("");
    const [icon, setIcon] = useState("");
    const [iconPickerOpen, setIconPickerOpen] = useState(false);
    const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState<string[]>([]);
    const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);
    const [query, setQuery] = useState("");
    const [maxFeedItems, setMaxFeedItems] = useState("200");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isAllFeed = feed?.id === "all";

    useEffect(() => {
        if (!open) {
            return;
        }

        setTitle(feed?.title || (isAllFeed ? "All feed" : ""));
        setIcon(feed?.icon || "");
        setSelectedSubscriptionIds(isAllFeed
            ? [...(feed?.excludedSubscriptionRefs ?? [])]
            : [...(feed?.subscriptionRefs ?? [])]);
        setSelectedFeedIds(isAllFeed ? [] : [...(feed?.includedFeedRefs ?? [])]);
        setMaxFeedItems(String(feed?.maxFeedItems || 200));
        setQuery("");
        setError(null);
    }, [feed, isAllFeed, open]);

    const sortedSubscriptions = useMemo(
        () => subscriptions
            .slice()
            .sort((left, right) => String(left.title || "").localeCompare(String(right.title || ""))),
        [subscriptions],
    );

    const subscriptionsById = useMemo(() => {
        return new Map(sortedSubscriptions.map((entry) => [entry.id, entry] as const));
    }, [sortedSubscriptions]);

    const sortedFeeds = useMemo(
        () => feeds
            .filter((entry) => entry.id !== "all")
            .slice()
            .sort((left, right) => left.title.localeCompare(right.title)),
        [feeds],
    );

    const filteredSubscriptions = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return sortedSubscriptions;
        }

        return sortedSubscriptions.filter((entry) =>
            entry.title.toLowerCase().includes(normalizedQuery),
        );
    }, [query, sortedSubscriptions]);

    const selectedLabels = useMemo(
        () => selectedSubscriptionIds
            .map((subscriptionId) => subscriptionsById.get(subscriptionId)?.title)
            .filter((title): title is string => Boolean(title)),
        [selectedSubscriptionIds, subscriptionsById],
    );

    const toggleSubscription = (subscriptionId: string) => {
        setSelectedSubscriptionIds((current) => {
            if (current.includes(subscriptionId)) {
                return current.filter((entryId) => entryId !== subscriptionId);
            }

            return [...current, subscriptionId];
        });
    };

    const toggleFeed = (feedId: string) => {
        setSelectedFeedIds((current) => current.includes(feedId)
            ? current.filter((entryId) => entryId !== feedId)
            : [...current, feedId]);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setError(null);

        try {
            if (!feed?.id) {
                throw new Error("Feed details are still loading");
            }

            const normalizedTitle = title.trim();
            const normalizedMaxFeedItems = Math.max(1, Math.floor(Number(maxFeedItems) || 200));
            const payload: NewsFeedRecordUpdateInput = {
                feedId: feed.id,
                title: isAllFeed ? "All" : normalizedTitle || String(feed.title || ""),
                icon,
                subscriptionRefs: isAllFeed
                    ? sortedSubscriptions.map((entry) => entry.id)
                    : selectedSubscriptionIds,
                excludedSubscriptionRefs: isAllFeed ? selectedSubscriptionIds : [],
                includedFeedRefs: isAllFeed ? [] : selectedFeedIds,
                maxFeedItems: normalizedMaxFeedItems,
            };

            await onSave(payload);
            await onClose();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
            <DialogContent className="frosted text-foreground w-[min(92vw,48rem)] max-w-none">
                <DialogHeader>
                    <DialogTitle>
                        {isAllFeed ? "Edit All feed" : `Edit ${feed?.title || "feed"}`}
                    </DialogTitle>
                    <DialogDescription>
                        {isAllFeed
                            ? "Exclude subscriptions from All feed. Everything else stays included."
                            : "Choose the subscriptions that belong in this feed."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <Label htmlFor="news-feed-title">Feed name</Label>
                        <div className="mt-1 flex items-center gap-2">
                            <Dialog open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                                <DialogTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="frosted h-10 w-10 shrink-0 p-0"
                                        title="Pick feed icon"
                                        disabled={saving || loading}
                                    >
                                        <Icon icon={icon || "solar:document-text-bold"} className="text-lg" />
                                        <span className="sr-only">Pick feed icon</span>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="frosted text-foreground w-[min(92vw,48rem)] max-w-none">
                                    <DialogHeader>
                                        <DialogTitle>Change Feed Icon</DialogTitle>
                                    </DialogHeader>
                                    <IconPickerComponent
                                        initialSelection={{ url: icon }}
                                        onSelect={(iconObj) => {
                                            setIcon(iconObj.url ?? "");
                                            setIconPickerOpen(false);
                                        }}
                                    />
                                </DialogContent>
                            </Dialog>
                            <Input
                                id="news-feed-title"
                                className="frosted min-w-0 flex-1"
                                value={isAllFeed ? "All" : title}
                                onChange={(event) => setTitle(event.target.value)}
                                disabled={saving || loading || isAllFeed}
                            />
                        </div>
                    </div>

                    <div>
                        <Label htmlFor="news-feed-max-items">Max feed items</Label>
                        <Input
                            id="news-feed-max-items"
                            className="frosted mt-1"
                            type="number"
                            min={1}
                            value={maxFeedItems}
                            onChange={(event) => setMaxFeedItems(event.target.value)}
                            disabled={saving || loading}
                        />
                    </div>

                    {!isAllFeed && (
                        <div>
                            <div className="flex items-center justify-between gap-3">
                                <Label>Included feeds</Label>
                                <span className="text-xs text-white/50">{selectedFeedIds.length} selected</span>
                            </div>
                            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-2">
                                {sortedFeeds.length === 0 && (
                                    <div className="px-3 py-2 text-sm text-white/50">No other feeds available.</div>
                                )}
                                <div className="max-h-[7.5rem] space-y-1 overflow-y-auto pr-1">
                                    {sortedFeeds.map((includedFeed) => {
                                        const isSelected = selectedFeedIds.includes(includedFeed.id);
                                        return (
                                            <button
                                                key={includedFeed.id}
                                                type="button"
                                                onClick={() => toggleFeed(includedFeed.id)}
                                                aria-pressed={isSelected}
                                                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${isSelected ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/5 hover:text-white"}`}
                                                disabled={saving || loading}
                                            >
                                                <Icon icon={isSelected ? "fa6-solid:check" : "fa6-regular:square"} className="text-sm" />
                                                <span className="min-w-0 flex-1 truncate">{includedFeed.title}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="news-feed-search">
                                {isAllFeed ? "Exclude subscriptions" : "Included subscriptions"}
                            </Label>
                            <span className="text-xs text-white/50">
                                {selectedLabels.length} selected
                            </span>
                        </div>
                        <Input
                            id="news-feed-search"
                            className="frosted mt-1"
                            placeholder="Search subscriptions"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            disabled={saving || loading}
                        />

                        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-2">
                            {loading && (
                                <div className="flex items-center gap-2 px-3 py-2 text-sm text-white/55">
                                    <Icon icon="fa6-solid:spinner" className="animate-spin text-xs" />
                                    Loading feed settings…
                                </div>
                            )}

                            {!loading && filteredSubscriptions.length === 0 && (
                                <div className="px-3 py-4 text-sm text-white/50">
                                    No subscriptions match your search.
                                </div>
                            )}

                            {!loading && filteredSubscriptions.length > 0 && (
                                <div className="max-h-[7.5rem] space-y-1 overflow-y-auto pr-1">
                                    {filteredSubscriptions.map((subscription) => {
                                        const isSelected = selectedSubscriptionIds.includes(subscription.id);

                                        return (
                                            <button
                                                key={subscription.id}
                                                type="button"
                                                onClick={() => toggleSubscription(subscription.id)}
                                                aria-pressed={isSelected}
                                                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                                                    isSelected
                                                        ? "bg-white/10 text-white"
                                                        : "text-white/75 hover:bg-white/5 hover:text-white"
                                                }`}
                                                disabled={saving || loading}
                                            >
                                                <span className="mt-0.5">
                                                    <Icon
                                                        icon={isSelected ? "fa6-solid:check" : "fa6-regular:square"}
                                                        className="text-sm"
                                                    />
                                                </span>
                                                <span className="min-w-0 flex-1 truncate">{subscription.title}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {selectedLabels.length === 0 && (
                                <span className="text-sm text-white/45">
                                    {isAllFeed ? "No exclusions yet." : "No subscriptions selected yet."}
                                </span>
                            )}
                            {selectedSubscriptionIds.map((subscriptionId) => {
                                const selected = subscriptionsById.get(subscriptionId);
                                if (!selected) return null;

                                return (
                                    <button
                                        key={subscriptionId}
                                        type="button"
                                        onClick={() => toggleSubscription(subscriptionId)}
                                        className="frosted inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white/80 transition-colors hover:bg-white/10"
                                        disabled={saving || loading}
                                    >
                                        <span className="max-w-56 truncate">{selected.title}</span>
                                        <Icon icon="fa6-solid:xmark" className="text-[10px]" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={saving || loading || !feed}>
                            {saving ? "Saving..." : "Save feed"}
                        </Button>
                    </div>

                    {error && <p className="text-sm text-red-400">{error}</p>}
                </form>
            </DialogContent>
        </Dialog>
    );
}
