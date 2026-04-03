import axios from "axios";
import { channelId } from "@gonetone/get-youtube-id-by-url";
import config from "../lib/config";
import { getFaviconFromDOM } from "../lib/api/tools/faviconFromDom";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type FeedItem = {
  title: string;
  link: string;
  pubDate: string | Date;
  [key: string]: any;
};

type Subscription = {
  category: string;
  feedUrl: string;
  icon?: string;
  name?: string;
};

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

function itemTime(item: FeedItem): number {
  const value = item?.pubDate;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

async function getUserNewsFeedRecord(userId: string) {
  const pb = await getSuperuserPB();
  try {
    return await pb
      .collection("newsFeeds")
      .getFirstListItem(`userId="${escapeFilter(userId)}"`);
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function buildFeedFromSubscriptions(subscriptions: Subscription[], category?: string | null) {
  const pb = await getSuperuserPB();
  let feed: Record<string, FeedItem[]> = {};

  const urls = Array.from(
    new Set(
      subscriptions
        .map((sub) => sub?.feedUrl)
        .filter((url): url is string => typeof url === "string" && url.length > 0)
    )
  );

  const cacheByUrl: Record<string, FeedItem[]> = {};
  if (urls.length > 0) {
    const filter = urls.map((url) => `url="${escapeFilter(url)}"`).join(" || ");
    const cacheRecords = await pb.collection("newsFeedItemsCache").getFullList({ filter });

    for (const cacheRecord of cacheRecords) {
      const raw = cacheRecord.json;
      if (!raw) {
        cacheByUrl[cacheRecord.url] = [];
        continue;
      }

      try {
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          cacheByUrl[cacheRecord.url] = Array.isArray(parsed) ? parsed : [];
        } else if (Array.isArray(raw)) {
          cacheByUrl[cacheRecord.url] = raw;
        } else {
          cacheByUrl[cacheRecord.url] = [];
        }
      } catch {
        cacheByUrl[cacheRecord.url] = [];
      }
    }
  }

  for (const sub of subscriptions) {
    if (!sub?.category || !sub?.feedUrl) continue;
    if (!feed[sub.category]) {
      feed[sub.category] = [];
    }
    feed[sub.category].push(...(cacheByUrl[sub.feedUrl] ?? []));
  }

  for (const key of Object.keys(feed)) {
    feed[key] = feed[key].sort((a, b) => itemTime(b) - itemTime(a)).slice(0, 10);
  }

  if (category && category !== "All") {
    feed = feed[category] ? { [category]: feed[category] } : {};
  }

  return feed;
}

export async function getNewsFeed(userId: string, category?: string | null) {
  const record = await getUserNewsFeedRecord(userId);
  if (!record) {
    return { feed: {} };
  }

  const subscriptions = record.subscriptions ?? [];
  const feed = await buildFeedFromSubscriptions(subscriptions, category);
  return { feed };
}

export async function getNewsSubscriptions(userId: string) {
  const record = await getUserNewsFeedRecord(userId);
  return {
    id: record?.id ?? null,
    subscriptions: record?.subscriptions ?? [],
  };
}

export async function refreshNewsFeed(userId: string) {
  if (!config.jobs_webhook_enabled) {
    return { message: "Jobs webhook is disabled" };
  }

  const record = await getUserNewsFeedRecord(userId);
  if (!record?.id) {
    return { message: "No subscriptions found for user" };
  }

  const url = `${config.jobs_url}/webhook/newsFeedBuilder?feedId=${record.id}`;
  const response = await axios.get(url);
  return response.data;
}

export async function subscribeNewsFeed(
  userId: string,
  sub: { feedUrl: string; name?: string; icon?: string; category?: string }
) {
  const pb = await getSuperuserPB();
  const filter = `userId="${escapeFilter(userId)}"`;

  const originalFeedUrl = sub.feedUrl;
  if (originalFeedUrl.includes("https://www.youtube.com/@")) {
    const id = await channelId(originalFeedUrl);
    if (id) {
      sub.feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    }
  }

  if (!sub.name && originalFeedUrl.includes("https://www.youtube.com/@")) {
    const match = originalFeedUrl.match(/@([^/?#]+)/);
    sub.name = match?.[1] ? `@${match[1]}` : originalFeedUrl;
  }

  sub.icon = sub.icon?.trim() || (await getFaviconFromDOM(sub.feedUrl, true)) || "";

  let record: any = null;
  try {
    record = await pb.collection("newsFeeds").getFirstListItem(filter);
  } catch (error: any) {
    if (error?.status === 404) {
      await pb.collection("newsFeeds").create({ userId, subscriptions: [sub] });
      if (config.jobs_webhook_enabled) {
        await fetch(config.jobs_url + "/webhook/newsFeedBuilder");
      }
      return { message: "Feed successfully subscribed." };
    }
    throw error;
  }

  const current = Array.isArray(record.subscriptions)
    ? record.subscriptions.map((entry: any) => (typeof entry === "string" ? { feedUrl: entry } : entry))
    : [];

  if (!current.some((entry: any) => entry.feedUrl === sub.feedUrl)) {
    current.push(sub);
    await pb.collection("newsFeeds").update(record.id, { subscriptions: current });
  }

  if (config.jobs_webhook_enabled) {
    await fetch(config.jobs_url + "/webhook/newsFeedBuilder");
  }

  return { message: "Feed successfully subscribed." };
}

export async function unsubscribeNewsFeed(userId: string, feedUrl: string) {
  const pb = await getSuperuserPB();
  const filter = `userId="${escapeFilter(userId)}"`;

  const record = await pb.collection("newsFeeds").getFirstListItem(filter);
  const current = Array.isArray(record.subscriptions)
    ? record.subscriptions.map((entry: any) => (typeof entry === "string" ? { feedUrl: entry } : entry))
    : [];

  const next = current.filter((entry: any) => entry.feedUrl !== feedUrl);
  await pb.collection("newsFeeds").update(record.id, { subscriptions: next });

  return { message: "Feed successfully unsubscribed." };
}

export async function updateNewsFeed(
  userId: string,
  payload: { oldFeedUrl: string; feedUrl: string; name: string; icon: string; category: string }
) {
  const pb = await getSuperuserPB();
  const filter = `userId="${escapeFilter(userId)}"`;

  const record = await pb.collection("newsFeeds").getFirstListItem(filter);
  let found = false;

  const next = (Array.isArray(record.subscriptions) ? record.subscriptions : []).map((entry: any) => {
    const sub = typeof entry === "string" ? { feedUrl: entry } : entry;
    if (sub.feedUrl === payload.oldFeedUrl) {
      found = true;
      return {
        feedUrl: payload.feedUrl,
        name: payload.name || sub.name || payload.feedUrl,
        icon: payload.icon || sub.icon || "",
        category: payload.category || sub.category || "",
      };
    }
    return sub;
  });

  if (!found) {
    return { _status: 404, error: "Feed not found" };
  }

  await pb.collection("newsFeeds").update(record.id, { subscriptions: next });
  return { message: "Feed updated", subscriptions: next };
}
