"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@iconify-icon/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useAuth from "@/context/useAuth";
import {
  createLinkRssFeedAction,
  deleteLinkRssFeedAction,
  getLinkRssFeedsAction,
  getLinksCollectionsAction,
  getLinksItemsAction,
  getLinksTagsAction,
  updateLinkRssFeedAction,
  backendUrl,
  type LinkRssFeedInput,
  type LinkRssFeedRecord,
} from "@/lib/apiClient";

type LinkListOption = { id: string; name: string };
type LinkTagOption = { id: string; name: string; color?: string };
type LinkOption = { id: string; title: string; url?: string; tags?: string[] };

function toggle(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

export default function LinkRssFeedsSettings() {
  const { token, withAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [feeds, setFeeds] = useState<LinkRssFeedRecord[]>([]);
  const [lists, setLists] = useState<LinkListOption[]>([]);
  const [tags, setTags] = useState<LinkTagOption[]>([]);
  const [links, setLinks] = useState<LinkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [linkIds, setLinkIds] = useState<string[]>([]);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [copiedFeedId, setCopiedFeedId] = useState<string | null>(null);

  const listNames = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));
  const selectedLinks = links.filter((link) => linkIds.includes(link.id));

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void withAuth(async (auth) => {
      const [feedRows, listRows, tagRows] = await Promise.all([
        getLinkRssFeedsAction(auth),
        getLinksCollectionsAction(auth),
        getLinksTagsAction(auth),
      ]);
      if (!cancelled) {
        setFeeds(feedRows);
        setLists((listRows as unknown as LinkListOption[]).filter((list) => list.name.toLowerCase() !== "home"));
        setTags(tagRows as unknown as LinkTagOption[]);
      }
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, token, withAuth]);

  useEffect(() => {
    if (!open || !token || !listId) {
      setLinks([]);
      return;
    }
    let cancelled = false;
    void withAuth((auth) => getLinksItemsAction(auth, listId))
      .then((rows) => { if (!cancelled) setLinks(rows as unknown as LinkOption[]); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError)); });
    return () => { cancelled = true; };
  }, [listId, open, token, withAuth]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setListId("");
    setTagIds([]);
    setLinkIds([]);
    setRequiresAuth(false);
    setError(null);
  }

  function editFeed(feed: LinkRssFeedRecord) {
    setEditingId(feed.id);
    setName(feed.name);
    setListId(feed.listId);
    setTagIds(feed.tagIds ?? []);
    setLinkIds(feed.linkIds ?? []);
    setRequiresAuth(feed.requiresAuth);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    const payload: LinkRssFeedInput = { name, listId, tagIds, linkIds, requiresAuth };
    try {
      const result = await withAuth((auth) => editingId
        ? updateLinkRssFeedAction(auth, editingId, payload)
        : createLinkRssFeedAction(auth, payload));
      setFeeds((current) => editingId
        ? current.map((feed) => feed.id === result.id ? result : feed).sort((a, b) => a.name.localeCompare(b.name))
        : [...current, result].sort((a, b) => a.name.localeCompare(b.name)));
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeFeed(feed: LinkRssFeedRecord) {
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    try {
      await withAuth((auth) => deleteLinkRssFeedAction(auth, feed.id));
      setFeeds((current) => current.filter((entry) => entry.id !== feed.id));
      if (editingId === feed.id) resetForm();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setSaving(false);
    }
  }

  async function copyFeedUrl(feed: LinkRssFeedRecord) {
    const url = backendUrl(`/api/v1/links/rss/${encodeURIComponent(feed.id)}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFeedId(feed.id);
      window.setTimeout(() => setCopiedFeedId((current) => current === feed.id ? null : current), 1500);
    } catch {
      setError("Could not copy the feed URL. Select and copy it from the address field.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-transparent p-1.5 text-left hover-frosted"
      >
        <Icon icon="fa6-solid:rss" />
        <span>RSS feeds</span>
        <Icon icon="fa6-solid:caret-right" />
      </button>

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) { setOpen(nextOpen); if (!nextOpen) resetForm(); } }}>
        <DialogContent className="frosted text-foreground w-[min(94vw,48rem)] max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link RSS feeds</DialogTitle>
            <DialogDescription>Create RSS feeds from a link list, selected tags, and individual links.</DialogDescription>
          </DialogHeader>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Available feeds</h3>
              <Button type="button" size="sm" onClick={resetForm} disabled={saving}>
                <Icon icon="fa6-solid:plus" className="mr-1" /> New feed
              </Button>
            </div>
            {loading && <p className="py-3 text-sm text-white/55">Loading feeds…</p>}
            {!loading && feeds.length === 0 && <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/55">No feeds created yet.</p>}
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {feeds.map((feed) => {
                const feedUrl = backendUrl(`/api/v1/links/rss/${encodeURIComponent(feed.id)}`);
                return (
                  <div key={feed.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-start gap-3">
                      <Icon icon="fa6-solid:rss" className="mt-1 text-white/60" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{feed.name}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/55">
                            {feed.requiresAuth ? "Auth required" : "Public"}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-white/50">{listNames.get(feed.listId) ?? "Link list"}</div>
                        <a className="mt-1 block truncate text-xs text-sky-300 hover:underline" href={feedUrl} target="_blank" rel="noreferrer">{feedUrl}</a>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="ghost" size="icon" title="Copy RSS URL" onClick={() => void copyFeedUrl(feed)}>
                          <Icon icon={copiedFeedId === feed.id ? "fa6-solid:check" : "fa6-regular:copy"} />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Edit feed" onClick={() => editFeed(feed)}>
                          <Icon icon="fa6-solid:pen-to-square" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" title="Delete feed" onClick={() => void removeFeed(feed)} disabled={saving}>
                          <Icon icon="fa6-solid:trash" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <form onSubmit={handleSubmit} className="space-y-4 border-t border-white/10 pt-4">
            <h3 className="font-medium">{editingId ? "Edit feed" : "Create a feed"}</h3>
            <div>
              <Label htmlFor="link-rss-name">Feed name</Label>
              <Input id="link-rss-name" className="frosted mt-1" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} disabled={saving} />
            </div>
            <div>
              <Label htmlFor="link-rss-list">Link list</Label>
              <select id="link-rss-list" className="frosted mt-1 h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm" value={listId} onChange={(event) => { setListId(event.target.value); setTagIds([]); setLinkIds([]); }} required disabled={saving}>
                <option value="">Select a list</option>
                {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
              </select>
            </div>

            <SelectionList
              title="Include tags"
              empty="No tags available."
              entries={tags}
              selectedIds={tagIds}
              onToggle={(id) => setTagIds((current) => toggle(current, id))}
              disabled={saving}
              renderLabel={(tag) => <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color || "#94a3b8" }} />{tag.name}</span>}
            />

            <SelectionList
              title="Include individual links"
              empty={listId ? "No links in this list." : "Choose a list to view its links."}
              entries={links}
              selectedIds={linkIds}
              onToggle={(id) => setLinkIds((current) => toggle(current, id))}
              disabled={saving || !listId}
              renderLabel={(link) => <span className="min-w-0 truncate">{link.title || link.url}</span>}
            />

            {selectedTags.length + selectedLinks.length === 0 && (
              <p className="text-xs text-white/50">Select at least one tag or link. Matching tagged links and selected links will be included.</p>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={requiresAuth} onChange={(event) => setRequiresAuth(event.target.checked)} disabled={saving} className="accent-sky-400" />
              Require Dashwise authentication to read this feed
            </label>

            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <DialogFooter>
              {editingId && <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>Cancel edit</Button>}
              <Button type="submit" disabled={saving || loading || !listId || (!tagIds.length && !linkIds.length)}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create feed"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SelectionList<T extends { id: string }>({
  title,
  empty,
  entries,
  selectedIds,
  onToggle,
  disabled,
  renderLabel,
}: {
  title: string;
  empty: string;
  entries: T[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  renderLabel: (entry: T) => ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <span className="text-xs text-white/50">{selectedIds.length} selected</span>
      </div>
      <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
        {entries.length === 0 && <p className="px-2 py-2 text-sm text-white/50">{empty}</p>}
        {entries.map((entry) => {
          const selected = selectedIds.includes(entry.id);
          return (
            <button key={entry.id} type="button" onClick={() => onToggle(entry.id)} aria-pressed={selected} disabled={disabled} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${selected ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5"}`}>
              <Icon icon={selected ? "fa6-solid:check-square" : "fa6-regular:square"} className="shrink-0" />
              {renderLabel(entry)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
