"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@iconify-icon/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { NewsFeedDraft } from "@dashwise/sdk/data/news";

interface FeedOption {
  id: string;
  title: string;
}

interface SubscriptionDetailsFormProps {
  feed?: NewsFeedDraft;
  feeds: FeedOption[];
  onClose?: () => void | Promise<void>;
  onSave?: (feed: NewsFeedDraft) => Promise<void> | void;
  resolveFeedMetadata?: (feedUrl: string) => Promise<{ title?: string; icon?: string } | null | undefined>;
}

export default function SubscriptionDetailsForm({
  feed,
  feeds,
  onClose,
  onSave,
  resolveFeedMetadata,
}: SubscriptionDetailsFormProps) {
  const [feedUrl, setFeedUrl] = useState<string>(() => feed?.feedUrl || "");
  const [name, setName] = useState<string>(() => feed?.name || "");
  const [icon, setIcon] = useState<string>(() => feed?.icon || "");
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>(() => feed?.feedIds || []);
  const [newFeedTitles, setNewFeedTitles] = useState<string[]>(() => feed?.newFeedTitles || []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<string>(name);
  const iconRef = useRef<string>(icon);
  const lastAutoNameRef = useRef<string>("");
  const lastAutoIconRef = useRef<string>("");

  const [subscriptionType, setSubscriptionType] = useState<"rss" | "youtube" | "reddit" | "github">("rss");

  // Reddit state
  const [redditType, setRedditType] = useState<"subreddit" | "user">("subreddit");
  const [redditName, setRedditName] = useState("");

  // Github state
  const [githubRepo, setGithubRepo] = useState("");
  const [githubFeedType, setGithubFeedType] = useState<"issues" | "pulls" | "releases" | "releases_stable">("releases");

  // Youtube state
  const [youtubeId, setYoutubeId] = useState("");

  const isEditing = Boolean(feed?.id);

  // Auto-generate feedUrl based on selected type
  useEffect(() => {
    if (isEditing) return;

    if (subscriptionType === "reddit" && redditName) {
      setFeedUrl(`https://www.reddit.com/${redditType === "subreddit" ? "r" : "user"}/${redditName}/.rss`);
    } else if (subscriptionType === "github" && githubRepo) {
      let suffix = "releases.atom";
      if (githubFeedType === "issues") suffix = "issues.atom";
      if (githubFeedType === "pulls") suffix = "pulls.atom";
      if (githubFeedType === "releases_stable") suffix = "releases.atom"; // stable filtering might require backend support, but URL is the same
      setFeedUrl(`https://github.com/${githubRepo}/${suffix}`);
    } else if (subscriptionType === "youtube" && youtubeId) {
      if (youtubeId.startsWith("UC")) {
        setFeedUrl(`https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeId}`);
      } else {
        setFeedUrl(`https://www.youtube.com/feeds/videos.xml?user=${youtubeId}`);
      }
    }
  }, [subscriptionType, redditType, redditName, githubRepo, githubFeedType, youtubeId, isEditing]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    iconRef.current = icon;
  }, [icon]);

  useEffect(() => {
    if (!resolveFeedMetadata) return;

    const trimmedUrl = feedUrl.trim();
    if (!trimmedUrl) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        new URL(trimmedUrl);
      } catch {
        return;
      }

      setMetadataLoading(true);

      try {
        const metadata = await resolveFeedMetadata(trimmedUrl);
        if (cancelled || !metadata) return;

        const resolvedTitle = metadata.title?.trim();
        if (resolvedTitle) {
          const currentName = nameRef.current.trim();
          if (!currentName || currentName === lastAutoNameRef.current) {
            lastAutoNameRef.current = resolvedTitle;
            setName(resolvedTitle);
          }
        }

        const resolvedIcon = metadata.icon?.trim();
        if (resolvedIcon) {
          const currentIcon = iconRef.current.trim();
          if (!currentIcon || currentIcon === lastAutoIconRef.current) {
            lastAutoIconRef.current = resolvedIcon;
            setIcon(resolvedIcon);
          }
        }
      } catch {
        // Autofill is best-effort only.
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [feedUrl, resolveFeedMetadata]);

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

      const payload: NewsFeedDraft = {
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
      {!isEditing && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge
            variant={subscriptionType === "rss" ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setSubscriptionType("rss")}
          >
            <Icon icon="fa6-solid:rss" className="mr-1.5" /> Generic RSS
          </Badge>
          <Badge
            variant={subscriptionType === "youtube" ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setSubscriptionType("youtube")}
          >
            <Icon icon="fa6-brands:youtube" className="mr-1.5" /> YouTube
          </Badge>
          <Badge
            variant={subscriptionType === "reddit" ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setSubscriptionType("reddit")}
          >
            <Icon icon="fa6-brands:reddit" className="mr-1.5" /> Reddit
          </Badge>
          <Badge
            variant={subscriptionType === "github" ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setSubscriptionType("github")}
          >
            <Icon icon="fa6-brands:github" className="mr-1.5" /> GitHub
          </Badge>
        </div>
      )}

      {subscriptionType === "rss" && (
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
          {metadataLoading && (
            <p className="mt-1 text-xs text-white/50">Looking up feed title and icon...</p>
          )}
        </div>
      )}

      {subscriptionType === "reddit" && !isEditing && (
        <div className="flex gap-2">
          <div className="w-1/3">
            <Label>Type</Label>
            <Select value={redditType} onValueChange={(v: any) => setRedditType(v)}>
              <SelectTrigger className="frosted mt-1">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subreddit">Subreddit</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-2/3">
            <Label htmlFor="reddit-name">{redditType === "subreddit" ? "Subreddit Name" : "Username"}</Label>
            <Input
              id="reddit-name"
              className="frosted mt-1"
              placeholder={redditType === "subreddit" ? "e.g. selfhosted" : "e.g. spez"}
              value={redditName}
              onChange={(e) => setRedditName(e.target.value)}
            />
          </div>
        </div>
      )}

      {subscriptionType === "github" && !isEditing && (
        <div className="flex gap-2">
          <div className="w-1/2">
            <Label htmlFor="github-repo">User / Repo</Label>
            <Input
              id="github-repo"
              className="frosted mt-1"
              placeholder="e.g. octocat/Hello-World"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
            />
          </div>
          <div className="w-1/2">
            <Label>Include</Label>
            <Select value={githubFeedType} onValueChange={(v: any) => setGithubFeedType(v)}>
              <SelectTrigger className="frosted mt-1">
                <SelectValue placeholder="Select content" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issues">New Issues</SelectItem>
                <SelectItem value="pulls">Pull Requests</SelectItem>
                <SelectItem value="releases">Releases</SelectItem>
                <SelectItem value="releases_stable">Releases (Stable Only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {subscriptionType === "youtube" && !isEditing && (
        <div>
          <Label htmlFor="youtube-id">Channel ID or Username</Label>
          <Input
            id="youtube-id"
            className="frosted mt-1"
            placeholder="e.g. UCX6OQ3DkcsbYNE6H8uQQuVA or user_name"
            value={youtubeId}
            onChange={(e) => setYoutubeId(e.target.value)}
          />
        </div>
      )}

      {subscriptionType !== "rss" && !isEditing && (
        <div>
          <Label htmlFor="generated-feed-url">Generated Feed URL</Label>
          <Input
            id="generated-feed-url"
            className="frosted mt-1 opacity-70"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            disabled={loading}
          />
        </div>
      )}

      <div>
        <Label htmlFor="feed-name">Feed Name</Label>
        <Input
          id="feed-name"
          className="frosted mt-1"
          placeholder="My Feed"
          value={name}
          onChange={(event) => {
            lastAutoNameRef.current = "";
            setName(event.target.value);
          }}
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
          onChange={(event) => {
            lastAutoIconRef.current = "";
            setIcon(event.target.value);
          }}
          disabled={loading}
        />
        <p className="mt-1 text-xs text-white/60">
          Leave empty to let the backend choose a default icon.
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
