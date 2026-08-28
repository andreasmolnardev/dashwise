"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import LinksHtmlTransfer from "@/components/settings/LinksHtmlTransfer";
import useAuth from "@/context/useAuth";
import { getNewsFeedsAction, subscribeNewsFeedAction } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type EmptyAppSectionProps = {
  title: string;
  icon: string;
  description?: string;
  children?: ReactNode;
};

function EmptyAppSection({ title, icon, description, children }: EmptyAppSectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Icon icon={icon} />
        {title}
      </h2>
      {description && (
        <div className="frosted rounded-lg border border-white/10 p-4 text-sm text-white/65">
          {description}
        </div>
      )}
      {children}
    </section>
  );
}

type NewsFeedOption = {
  id: string;
  title?: string;
};

function DefaultNewsFeedSetting({ feeds }: { feeds: NewsFeedOption[] }) {
  const { user, updateUserProperty } = useAuth();

  const newsPreferences = user?.newsPreferences;
  const preferences = newsPreferences && typeof newsPreferences === "object"
    ? newsPreferences as Record<string, unknown>
    : {};
  const configuredDefaultNewsPage = typeof preferences.defaultNewsPage === "string"
    ? preferences.defaultNewsPage.replace(/\/+$/, "")
    : "";
  const defaultNewsPage = configuredDefaultNewsPage && configuredDefaultNewsPage !== "/apps/news"
    ? configuredDefaultNewsPage
    : "/apps/news/all";

  async function handleChange(value: string) {
    await updateUserProperty("newsPreferences", {
      ...preferences,
      defaultNewsPage: value,
    });
  }

  return (
    <div className="flex border border-transparent items-center col-span-full p-1.5 rounded-md gap-2">
      <Icon icon="fa6-solid:arrow-right" />
      <p className="w-full">Default News Feed</p>

      <Select value={defaultNewsPage} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder="Feed" />
        </SelectTrigger>

        <SelectContent>
          <SelectItem value="/apps/news/overview">Overview</SelectItem>
          <SelectItem value="/apps/news/all">All</SelectItem>
          {feeds
            .filter((feed) => feed.id !== "all")
            .map((feed) => (
              <SelectItem key={feed.id} value={`/apps/news/${feed.id}`}>
                {feed.title || "Untitled feed"}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

    </div>
  );
}

function BulkNewsImportSetting({
  feeds,
  onFeedsChange,
}: {
  feeds: NewsFeedOption[];
  onFeedsChange: (feeds: NewsFeedOption[]) => void;
}) {
  const { token, withAuth } = useAuth();
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportUrls, setBulkImportUrls] = useState("");
  const [bulkImportFeedId, setBulkImportFeedId] = useState("unsorted");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportError, setBulkImportError] = useState<string | null>(null);
  const [bulkImportStatus, setBulkImportStatus] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const bulkImportRequest = searchParams.get("openNewsBulkImportModal");

  const openBulkImport = useCallback(() => {
    setBulkImportUrls("");
    setBulkImportFeedId("unsorted");
    setBulkImportError(null);
    setBulkImportStatus(null);
    setBulkImportOpen(true);
  }, []);

  useEffect(() => {
    const value = bulkImportRequest?.trim().toLowerCase();
    if (!value || ["false", "0", "no", "off"].includes(value)) return;

    openBulkImport();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("openNewsBulkImportModal");
      return next;
    }, { replace: true });
  }, [bulkImportRequest, openBulkImport, setSearchParams]);

  async function handleBulkImport() {
    const urls = Array.from(new Set(
      bulkImportUrls
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean),
    ));

    if (!urls.length) {
      setBulkImportError("Add at least one feed URL.");
      return;
    }

    if (!token) {
      setBulkImportError("You must be signed in to import feeds.");
      return;
    }

    setBulkImporting(true);
    setBulkImportError(null);
    setBulkImportStatus(null);

    const failures: string[] = [];
    let imported = 0;

    try {
      for (const url of urls) {
        try {
          await withAuth((auth) => subscribeNewsFeedAction(auth, {
            feedUrl: url,
            feedIds: bulkImportFeedId === "unsorted" ? [] : [bulkImportFeedId],
            newFeedTitles: bulkImportFeedId === "unsorted" ? ["Unsorted"] : [],
          }));
          imported += 1;
        } catch (error) {
          failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const response = await getNewsFeedsAction({ token });
      onFeedsChange(response.feeds ?? []);

      if (failures.length) {
        setBulkImportError(`${imported} imported. Failed: ${failures.join("; ")}`);
      } else {
        setBulkImportStatus(`${imported} feed${imported === 1 ? "" : "s"} imported.`);
        setBulkImportUrls("");
        window.setTimeout(() => setBulkImportOpen(false), 700);
      }
    } catch (error) {
      setBulkImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setBulkImporting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openBulkImport}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-transparent p-1.5 text-left hover-frosted"
      >
        <Icon icon="fa6-solid:list" />
        <p className="w-full">Bulk import</p>
        <Icon icon="fa6-solid:caret-right" />
      </button>

      <Dialog open={bulkImportOpen} onOpenChange={(open) => !bulkImporting && setBulkImportOpen(open)}>
        <DialogContent className="frosted text-foreground w-[min(92vw,36rem)] max-w-none">
          <DialogHeader>
            <DialogTitle>Bulk import news feeds</DialogTitle>
            <DialogDescription>
              Add one RSS, Atom, YouTube, GitHub, or Reddit URL per line.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="bulk-news-feed-urls">Feed URLs</Label>
              <Textarea
                id="bulk-news-feed-urls"
                className="frosted mt-1 min-h-40"
                placeholder="https://example.com/feed.xml\nhttps://example.org/rss.xml"
                value={bulkImportUrls}
                onChange={(event) => setBulkImportUrls(event.target.value)}
                disabled={bulkImporting}
              />
            </div>

            <div>
              <Label htmlFor="bulk-news-feed-destination">Add to feed</Label>
              <Select
                value={bulkImportFeedId}
                onValueChange={setBulkImportFeedId}
                disabled={bulkImporting}
              >
                <SelectTrigger id="bulk-news-feed-destination" className="frosted mt-1 w-full">
                  <SelectValue placeholder="Select feed" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unsorted">Unsorted</SelectItem>
                  {feeds
                    .filter((feed) => feed.id !== "all")
                    .map((feed) => (
                      <SelectItem key={feed.id} value={feed.id}>
                        {feed.title || "Untitled feed"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {bulkImportStatus && <p className="text-sm text-emerald-400">{bulkImportStatus}</p>}
            {bulkImportError && <p className="text-sm text-red-400">{bulkImportError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkImportOpen(false)} disabled={bulkImporting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleBulkImport} disabled={bulkImporting}>
              {bulkImporting ? "Importing..." : "Import feeds"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewsSettings() {
  const { token } = useAuth();
  const [feeds, setFeeds] = useState<NewsFeedOption[]>([]);

  useEffect(() => {
    if (!token) {
      setFeeds([]);
      return;
    }

    let cancelled = false;
    void getNewsFeedsAction({ token })
      .then((response) => {
        if (!cancelled) setFeeds(response.feeds ?? []);
      })
      .catch(() => {
        if (!cancelled) setFeeds([]);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <DefaultNewsFeedSetting feeds={feeds} />
      <BulkNewsImportSetting feeds={feeds} onFeedsChange={setFeeds} />
    </>
  );
}

export default function AppsSettingsPage() {
  return (
    <main className="space-y-6">
      <header>
        <p className="text-2xl font-semibold">Apps</p>
      </header>

      <EmptyAppSection
        title="News"
        icon="fa6-solid:newspaper"
      >
        <NewsSettings />
      </EmptyAppSection>

      <EmptyAppSection
        title="Notifications"
        icon="fa6-solid:bell"
        description="Notification settings will be available here soon. Delivery defaults, topic management, and notification retention are planned for this section."
      />

      <EmptyAppSection
        title="Monitoring"
        icon="fa6-solid:chart-line"
        description="Monitoring settings will be available here soon. Polling defaults, history retention, and status-change notification rules are good candidates for this section."
      />

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Icon icon="fa6-solid:link" />
          Links
        </h2>
        <LinksHtmlTransfer />
      </section>
    </main>
  );
}
