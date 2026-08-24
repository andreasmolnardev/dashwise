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
import { Switch } from "@/components/ui/switch";
import type { NewsFeedDraft } from "@dashwise/types/sdk";

interface FeedOption {
  id: string;
  title: string;
}

interface SubscriptionDetailsFormProps {
  feed?: NewsFeedDraft;
  feeds: FeedOption[];
  onClose?: () => void | Promise<void>;
  onSave?: (feed: NewsFeedDraft) => Promise<void> | void;
  onDelete?: (feedId: string) => Promise<void> | void;
  resolveFeedMetadata?: (feedUrl: string) => Promise<{
    title?: string;
    icon?: string;
    suggestedBlacklistWords?: string[];
  } | null | undefined>;
}

export default function SubscriptionDetailsForm({
  feed,
  feeds,
  onClose,
  onSave,
  onDelete,
  resolveFeedMetadata,
}: SubscriptionDetailsFormProps) {
  const [feedUrl, setFeedUrl] = useState<string>(() => feed?.feedUrl || "");
  const [name, setName] = useState<string>(() => feed?.name || "");
  const [icon, setIcon] = useState<string>(() => feed?.icon || "");
  const [fallbackThumbnailUrl, setFallbackThumbnailUrl] = useState<string>(() => feed?.fallbackThumbnailUrl || "");
  const [thumbnailOverwriteUrl, setThumbnailOverwriteUrl] = useState<string>(() => feed?.thumbnailOverwriteUrl || "");
  const [similarityGroupingWordsBlacklist, setSimilarityGroupingWordsBlacklist] = useState<string>(() => feed?.similarityGroupingWordsBlacklist || "");
  const [enableTopicGrouping, setEnableTopicGrouping] = useState<boolean>(() => feed?.enableTopicGrouping !== false);
  const [activeOptionsTab, setActiveOptionsTab] = useState<"link" | "thumbnail" | "grouping">("link");
  const initialReplaceRuleKey = feed?.linkReplaceRule ? Object.keys(feed.linkReplaceRule)[0] || "" : "";
  const [replaceSearch, setReplaceSearch] = useState<string>(initialReplaceRuleKey);
  const [replaceWith, setReplaceWith] = useState<string>(initialReplaceRuleKey ? String(feed?.linkReplaceRule?.[initialReplaceRuleKey] || "") : "");
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>(() => feed?.feedIds || []);
  const [newFeedTitles, setNewFeedTitles] = useState<string[]>(() => feed?.newFeedTitles || []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [serverGroupingWords, setServerGroupingWords] = useState<string[] | null>(null);
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
  const [githubFeedType, setGithubFeedType] = useState<"updates" | "prs" | "commits" | "issues" | "issue_updates">("updates");
  const [githubBranch, setGithubBranch] = useState("");
  const [githubIssueId, setGithubIssueId] = useState("");

  const isEditing = Boolean(feed?.id);

  // Auto-detect subscription type from URL
  useEffect(() => {
    const url = feedUrl.toLowerCase();
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      setSubscriptionType("youtube");
    } else if (url.includes("reddit.com")) {
      setSubscriptionType("reddit");
    } else if (url.includes("github.com")) {
      setSubscriptionType("github");
      // Try to extract repo
      const match = feedUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (match) setGithubRepo(match[1]);
    } else {
      setSubscriptionType("rss");
    }
  }, [feedUrl]);

  // Auto-generate feedUrl based on GitHub options
  useEffect(() => {
    if (subscriptionType === "github" && githubRepo) {
      let url = `https://github.com/${githubRepo}`;
      if (githubFeedType === "updates") url += "/releases.atom";
      else if (githubFeedType === "prs") url += "/pulls.atom";
      else if (githubFeedType === "commits") url += `/commits/${githubBranch || "main"}.atom`;
      else if (githubFeedType === "issues") url += "/issues.atom";
      else if (githubFeedType === "issue_updates" && githubIssueId) url += `/issues/${githubIssueId}.atom`;
      else return; // Don't update if incomplete

      setFeedUrl(url);
    }
  }, [subscriptionType, githubRepo, githubFeedType, githubBranch, githubIssueId]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    iconRef.current = icon;
  }, [icon]);

  useEffect(() => {
    if (!resolveFeedMetadata) return;

    const trimmedUrl = feedUrl.trim();
    setServerGroupingWords(null);
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

        setServerGroupingWords(metadata.suggestedBlacklistWords ?? []);

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

  const cachedGroupingWords = useMemo(() => {
    const items = Array.isArray(feed?.json) ? feed.json : [];
    const counts = new Map<string, number>();

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const text = [record.title, record.description, record.summary, record.categories, record.tags]
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .join(" ")
        .toLowerCase()
        .replace(/<[^>]*>/g, " ")
        .replace(/[^a-z0-9]+/g, " ");

      for (const token of text.split(" ")) {
        const word = token.trim();
        if (word.length < 3) continue;
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 18)
      .map(([word]) => word);
  }, [feed?.json]);

  const commonGroupingWords = serverGroupingWords ?? cachedGroupingWords;

  const addBlacklistWord = (word: string) => {
    const nextWord = word.trim();
    if (!nextWord) return;

    setSimilarityGroupingWordsBlacklist((current) => {
      const entries = current.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (entries.some((entry) => entry.toLowerCase() === nextWord.toLowerCase())) return current;
      return [...entries, nextWord].join(", ");
    });
  };

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

      let currentSelectedFeedIds = [...selectedFeedIds];
      let currentSelectedNewTitles = [...selectedNewTitles];

      if (!currentSelectedFeedIds.length && !currentSelectedNewTitles.length) {
        currentSelectedNewTitles = ["Unsorted"];
      }

      let linkReplaceRule: Record<string, string> | undefined = undefined;
      if (replaceSearch.trim() && replaceWith.trim()) {
        linkReplaceRule = { [replaceSearch.trim()]: replaceWith.trim() };
      }

      const payload: NewsFeedDraft = {
        feedUrl: feedUrl.trim(),
        title: name.trim() || feedUrl.trim(),
        icon: icon.trim(),
        feedIds: currentSelectedFeedIds,
        newFeedTitles: currentSelectedNewTitles,
        fallbackThumbnailUrl: fallbackThumbnailUrl.trim() || undefined,
        thumbnailOverwriteUrl: thumbnailOverwriteUrl.trim() || undefined,
        similarityGroupingWordsBlacklist: similarityGroupingWordsBlacklist.trim(),
        enableTopicGrouping,
        linkReplaceRule,
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

  const handleIconClick = () => {
    const url = window.prompt("Enter icon URL:", icon);
    if (url !== null) {
      lastAutoIconRef.current = "";
      setIcon(url);
    }
  };

  const handleDelete = async () => {
    if (!feed?.id || !onDelete) return;
    if (!window.confirm("Are you sure you want to unsubscribe from this feed?")) return;

    setLoading(true);
    setError(null);
    try {
      await onDelete(feed.id);
      if (onClose) await onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <Label htmlFor="feed-url">Feed URL *</Label>
          <Input
            id="feed-url"
            className="frosted mt-1"
            placeholder="https://example.com/feed.xml"
            value={feedUrl}
            onChange={(event) => setFeedUrl(event.target.value)}
            disabled={loading}
          />
        </div>

        <div style={{ width: 200 }}>
          <Label>Add to Feed</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="frosted mt-1 flex w-full h-10 items-center justify-between rounded-md px-3 text-left"
                disabled={loading}
              >
                <span className="truncate text-sm text-white/70">
                  {allSelectedLabels.length ? allSelectedLabels[0] + (allSelectedLabels.length > 1 ? ` (+${allSelectedLabels.length - 1})` : "") : "Select feeds"}
                </span>
                <Icon icon="fa6-solid:chevron-down" className="text-xs text-white/50 shrink-0 ml-1" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="frosted w-80 p-0 text-foreground" align="end">
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
        </div>
      </div>

      <p className="text-xs text-white/60">
        All RSS and Atom feed URLs as well as YouTube, GitHub, and Reddit links work.
      </p>

      {subscriptionType === "github" && (
        <div className="space-y-3 p-3 rounded-xl bg-white/5 border border-white/10">
          <Label className="text-xs uppercase tracking-wider opacity-50">GitHub Subscription Options</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {[
                { id: "updates", label: "Releases / Updates" },
                { id: "prs", label: "Pull Requests" },
                { id: "commits", label: "Commits" },
                { id: "issues", label: "New Issues" },
                { id: "issue_updates", label: "Issue Updates" },
              ].map((opt) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    id={`gh-${opt.id}`}
                    name="githubFeedType"
                    checked={githubFeedType === opt.id}
                    onChange={() => setGithubFeedType(opt.id as any)}
                    className="w-4 h-4 accent-blue-500"
                  />
                  <label htmlFor={`gh-${opt.id}`} className="text-sm cursor-pointer">{opt.label}</label>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {githubFeedType === "commits" && (
                <div>
                  <Label htmlFor="gh-branch" className="text-xs">Branch</Label>
                  <Input
                    id="gh-branch"
                    placeholder="main"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                    className="h-8 text-sm frosted mt-1"
                  />
                </div>
              )}
              {githubFeedType === "issue_updates" && (
                <div>
                  <Label htmlFor="gh-issue" className="text-xs">Issue ID</Label>
                  <Input
                    id="gh-issue"
                    placeholder="123"
                    value={githubIssueId}
                    onChange={(e) => setGithubIssueId(e.target.value)}
                    className="h-8 text-sm frosted mt-1"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <hr className="border-white/10" />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleIconClick}
          className="w-12 h-10 rounded-md frosted flex items-center justify-center hover:bg-white/10 transition-colors shrink-0 overflow-hidden border border-white/10"
          title="Change icon"
        >
          {icon ? (
            <img src={icon} alt="" className="w-6 h-6 object-contain" />
          ) : (
            <Icon icon="fa6-solid:rss" className="text-lg opacity-50" />
          )}
        </button>

        <div className="flex-1">
          <Input
            id="feed-name"
            className="frosted w-full"
            placeholder="Feed Name"
            value={name}
            onChange={(event) => {
              lastAutoNameRef.current = "";
              setName(event.target.value);
            }}
            disabled={loading}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
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

      <div className="space-y-4 mt-4">
        <div className="flex flex-wrap gap-2 border-b border-white/10">
          {[
            { id: "link", label: "Link Rewrite" },
            { id: "thumbnail", label: "Thumbnail" },
            { id: "grouping", label: "Topic Grouping" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveOptionsTab(tab.id as "link" | "thumbnail" | "grouping")}
              className={`px-3 py-2 text-sm transition ${activeOptionsTab === tab.id ? "border-b-2 border-primary text-white" : "text-white/60 hover:text-white"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeOptionsTab === "link" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="replace-search" className="text-xs">Link Replace: Search</Label>
              <Input
                id="replace-search"
                className="h-8 text-sm frosted mt-1"
                placeholder="old-domain.com"
                value={replaceSearch}
                onChange={(e) => setReplaceSearch(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="replace-with" className="text-xs">Link Replace: With</Label>
              <Input
                id="replace-with"
                className="h-8 text-sm frosted mt-1"
                placeholder="new-domain.com"
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        )}

        {activeOptionsTab === "thumbnail" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="fallback-thumbnail" className="text-xs">Fallback Thumbnail URL</Label>
              <Input
                id="fallback-thumbnail"
                className="h-8 text-sm frosted mt-1"
                placeholder="https://example.com/image.png"
                value={fallbackThumbnailUrl}
                onChange={(e) => setFallbackThumbnailUrl(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="thumbnail-overwrite" className="text-xs">Thumbnail Overwrite URL</Label>
              <Input
                id="thumbnail-overwrite"
                className="h-8 text-sm frosted mt-1"
                placeholder="https://example.com/thumbnail.png"
                value={thumbnailOverwriteUrl}
                onChange={(e) => setThumbnailOverwriteUrl(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        )}

        {activeOptionsTab === "grouping" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
              <div>
                <Label htmlFor="enable-topic-grouping" className="text-sm">Enable Topic Grouping</Label>
                <p className="text-xs text-white/50">Group similar articles from this subscription into related story clusters.</p>
              </div>
              <Switch
                id="enable-topic-grouping"
                checked={enableTopicGrouping}
                onCheckedChange={setEnableTopicGrouping}
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="topic-blacklist" className="text-xs">Blacklist Words</Label>
              <Input
                id="topic-blacklist"
                className="h-8 text-sm frosted mt-1"
                placeholder="rumor, recap, sponsored, -it"
                value={similarityGroupingWordsBlacklist}
                onChange={(e) => setSimilarityGroupingWordsBlacklist(e.target.value)}
                disabled={loading}
              />
              <p className="mt-1 text-xs text-white/50">Comma-separated, case-insensitive words. Prefix a default word with - to allow it again.</p>
            </div>

            {metadataLoading && serverGroupingWords === null && feedUrl.trim() && (
              <p className="text-xs text-white/50">Analyzing recent articles for feed-specific words...</p>
            )}

            {commonGroupingWords.length > 0 && (
              <div>
                <Label className="text-xs">Suggested Blacklist Words</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {commonGroupingWords.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => addBlacklistWord(word)}
                      className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/20 hover:text-white"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-2">
        <div className="flex justify-between gap-3">
          {isEditing && onDelete ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={loading}
              className="hover:bg-red-500/20 text-red-500 border-red-500/20"
            >
              Unsubscribe
            </Button>
          ) : <div />}
          <div className="flex gap-3">
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
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
