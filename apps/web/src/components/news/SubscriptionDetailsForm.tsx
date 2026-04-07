"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "@iconify-icon/react";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface NewsFeed {
  id?: string;
  feedUrl: string;
  name?: string;
  icon?: string;
  feedIds?: string[];
  newFeedTitles?: string[];
}

interface FeedOption {
  id: string;
  title: string;
}

interface SubscriptionDetailsFormProps {
  feed?: NewsFeed;
  feeds: FeedOption[];
  onClose?: () => void | Promise<void>;
  onSave?: (feed: NewsFeed) => Promise<void> | void;
}

export default function SubscriptionDetailsForm({
  feed,
  feeds,
  onClose,
  onSave,
}: SubscriptionDetailsFormProps) {
  const [feedUrl, setFeedUrl] = useState(() => feed?.feedUrl || "");
  const [name, setName] = useState(() => feed?.name || "");
  const [icon, setIcon] = useState(() => feed?.icon || "");
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>(() => feed?.feedIds || []);
  const [newFeedTitles, setNewFeedTitles] = useState<string[]>(() => feed?.newFeedTitles || []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(feed?.id);

  const availableFeeds = useMemo(
    () => feeds.filter((entry) => entry.id !== "all"),
    [feeds],
  );

  const selectedFeedTitles = useMemo(
    () => selectedFeedIds
      .map((id) => availableFeeds.find((entry) => entry.id === id)?.title)
      .filter((title): title is string => Boolean(title)),
    [availableFeeds, selectedFeedIds],
  );

  const selectedNewTitles = useMemo(
    () => newFeedTitles.filter((title) => title.trim().length > 0),
    [newFeedTitles],
  );

  const allSelectedLabels = [...selectedFeedTitles, ...selectedNewTitles];

  const normalizedQuery = query.trim();
  const exactFeedMatch = availableFeeds.find(
    (entry) => entry.title.toLowerCase() === normalizedQuery.toLowerCase(),
  );
  const filteredFeeds = normalizedQuery
    ? availableFeeds.filter((entry) =>
        entry.title.toLowerCase().includes(normalizedQuery.toLowerCase()),
      )
    : availableFeeds;

  const toggleFeed = (feedId: string) => {
    setSelectedFeedIds((current) =>
      current.includes(feedId)
        ? current.filter((entryId) => entryId !== feedId)
        : [...current, feedId],
    );
  };

  const createFeed = () => {
    const title = normalizedQuery;
    if (!title) return;

    if (exactFeedMatch) {
      toggleFeed(exactFeedMatch.id);
      setQuery("");
      return;
    }

    setNewFeedTitles((current) => {
      if (current.some((entry) => entry.toLowerCase() === title.toLowerCase())) {
        return current;
      }
      return [...current, title];
    });
    setQuery("");
  };

  const removeFeedId = (feedId: string) => {
    setSelectedFeedIds((current) => current.filter((entryId) => entryId !== feedId));
  };

  const removeNewFeedTitle = (title: string) => {
    setNewFeedTitles((current) => current.filter((entry) => entry !== title));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!feedUrl.trim()) {
        throw new Error("Feed URL is required");
      }

      if (!selectedFeedIds.length && !selectedNewTitles.length) {
        throw new Error("Add the feed to at least one feed bucket");
      }

      const payload: NewsFeed = {
        feedUrl: feedUrl.trim(),
        name: name.trim() || feedUrl.trim(),
        icon: icon.trim(),
        feedIds: selectedFeedIds,
        newFeedTitles: selectedNewTitles,
      };

      if (feed?.id) {
        payload.id = feed.id;
      }

      if (onSave) {
        await onSave(payload);
      }

      if (onClose) await onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="feed-url">Feed URL *</Label>
        <Input
          id="feed-url"
          className="frosted mt-1"
          placeholder="https://example.com/feed.xml"
          value={feedUrl}
          onChange={(event) => setFeedUrl(event.target.value)}
          disabled={loading || isEditing}
        />
      </div>

      <div>
        <Label htmlFor="feed-name">Feed Name</Label>
        <Input
          id="feed-name"
          className="frosted mt-1"
          placeholder="My Feed"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={loading}
        />
      </div>

      <div>
        <Label htmlFor="feed-icon">Icon URL</Label>
        <Input
          id="feed-icon"
          className="frosted mt-1"
          placeholder="https://example.com/icon.png"
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          disabled={loading}
        />
        <p className="mt-1 text-xs text-white/60">
          Leave empty to let the backend choose a default icon
        </p>
      </div>

      <div>
        <Label>Add to Feed</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="frosted mt-1 flex w-full min-h-10 items-center justify-between rounded-md px-3 text-left"
              disabled={loading}
            >
              <span className={allSelectedLabels.length ? "text-white" : "text-white/50"}>
                {allSelectedLabels.length ? allSelectedLabels.join(", ") : "Search feeds or create one"}
              </span>
              <Icon icon="fa6-solid:chevron-down" className="text-xs text-white/50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="frosted w-80 p-0 text-foreground" align="start">
            <Command>
              <CommandInput
                placeholder="Search feeds"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <CommandEmpty>No feeds found.</CommandEmpty>
                <CommandGroup heading="Existing feeds">
                  {filteredFeeds.map((entry) => {
                    const isSelected = selectedFeedIds.includes(entry.id);
                    return (
                      <CommandItem
                        key={entry.id}
                        onSelect={() => toggleFeed(entry.id)}
                      >
                        <Icon
                          icon={isSelected ? "fa6-solid:check" : "fa6-regular:square"}
                          className="mr-2 text-sm"
                        />
                        {entry.title}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {normalizedQuery && !exactFeedMatch && (
                  <CommandGroup heading="Create new">
                    <CommandItem onSelect={createFeed}>
                      <Icon icon="fa6-solid:plus" className="mr-2 text-sm" />
                      Create "{normalizedQuery}"
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <div className="mt-2 flex flex-wrap gap-2">
          {selectedFeedIds.map((feedId) => {
            const selected = availableFeeds.find((entry) => entry.id === feedId);
            if (!selected) return null;

            return (
              <button
                key={feedId}
                type="button"
                onClick={() => removeFeedId(feedId)}
                className="frosted inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                <span>{selected.title}</span>
                <Icon icon="fa6-solid:xmark" className="text-[10px]" />
              </button>
            );
          })}
          {selectedNewTitles.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => removeNewFeedTitle(title)}
              className="frosted inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              <span>{title}</span>
              <Icon icon="fa6-solid:xmark" className="text-[10px]" />
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2">
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading
              ? isEditing
                ? "Saving..."
                : "Subscribing..."
              : isEditing
                ? "Save"
                : "Subscribe"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
