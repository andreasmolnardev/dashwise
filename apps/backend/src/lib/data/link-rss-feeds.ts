import { ApiActionError } from "./auth";
import { getServerPB } from "../pb/pocketbase";

export type LinkRssFeedInput = {
  name: string;
  listId: string;
  tagIds: string[];
  linkIds: string[];
  requiresAuth: boolean;
};

type FeedRecord = {
  id: string;
  user: string;
  name: string;
  listId: string;
  tagIds: string[];
  linkIds: string[];
  requiresAuth: boolean;
};

function cleanIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((id) => String(id).trim()).filter(Boolean))] : [];
}

function toFeed(record: any): FeedRecord {
  return {
    id: String(record.id),
    user: String(record.user),
    name: String(record.name ?? ""),
    listId: String(record.listId ?? ""),
    tagIds: cleanIds(record.tagIds),
    linkIds: cleanIds(record.linkIds),
    requiresAuth: record.requiresAuth === true,
  };
}

async function getOwnedFeed(userId: string, feedId: string) {
  const pb = getServerPB();
  let record: any;
  try {
    record = await pb.collection("linkRssFeeds").getOne(feedId);
  } catch {
    throw new ApiActionError("RSS feed not found", 404, { error: "RSS feed not found" });
  }
  if (String(record.user) !== userId) {
    throw new ApiActionError("RSS feed not found", 404, { error: "RSS feed not found" });
  }
  return { pb, record: toFeed(record) };
}

async function validateInput(userId: string, input: LinkRssFeedInput) {
  const pb = getServerPB();
  const name = String(input.name ?? "").trim();
  const listId = String(input.listId ?? "").trim();
  if (!name) throw new Error("Feed name is required");
  if (!listId) throw new Error("Choose a link list");

  const list = await pb.collection("linksLists").getOne(listId);
  if (String(list.user) !== userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });

  const tagIds = cleanIds(input.tagIds);
  const linkIds = cleanIds(input.linkIds);
  if (tagIds.length === 0 && linkIds.length === 0) {
    throw new Error("Select at least one tag or link");
  }
  const [tags, links] = await Promise.all([
    pb.collection("linksTags").getFullList({ filter: `user = "${userId}"` }),
    pb.collection("linkItems").getFullList({ filter: `collection = "${listId}"` }),
  ]);
  const allowedTags = new Set(tags.map((tag: any) => String(tag.id)));
  const allowedLinks = new Set(links.map((link: any) => String(link.id)));
  if (tagIds.some((id) => !allowedTags.has(id))) throw new Error("One or more selected tags are unavailable");
  if (linkIds.some((id) => !allowedLinks.has(id))) throw new Error("One or more selected links are unavailable");

  return {
    name,
    listId,
    tagIds,
    linkIds,
    requiresAuth: input.requiresAuth === true,
  };
}

export async function listLinkRssFeeds(userId: string) {
  const records = await getServerPB().collection("linkRssFeeds").getFullList({
    filter: `user = "${userId}"`,
    sort: "name",
  });
  return records.map((record: any) => toFeed(record));
}

export async function createLinkRssFeed(userId: string, input: LinkRssFeedInput) {
  const payload = await validateInput(userId, input);
  const record = await getServerPB().collection("linkRssFeeds").create({ ...payload, user: userId });
  return toFeed(record);
}

export async function updateLinkRssFeed(userId: string, feedId: string, input: LinkRssFeedInput) {
  const { record } = await getOwnedFeed(userId, feedId);
  const payload = await validateInput(userId, input);
  const updated = await getServerPB().collection("linkRssFeeds").update(record.id, payload);
  return toFeed(updated);
}

export async function deleteLinkRssFeed(userId: string, feedId: string) {
  const { pb, record } = await getOwnedFeed(userId, feedId);
  await pb.collection("linkRssFeeds").delete(record.id);
  return { id: record.id };
}

export async function getLinkRssFeedForRequest(feedId: string) {
  try {
    const record = await getServerPB().collection("linkRssFeeds").getOne(feedId);
    return toFeed(record);
  } catch {
    throw new ApiActionError("RSS feed not found", 404, { error: "RSS feed not found" });
  }
}

export async function getLinkRssFeedItems(feed: FeedRecord) {
  const pb = getServerPB();
  const links = await pb.collection("linkItems").getFullList({
    filter: `collection = "${feed.listId}"`,
    sort: "title",
  });
  const selectedLinkIds = new Set(feed.linkIds);
  const selectedTagIds = new Set(feed.tagIds);
  return links
    .filter((link: any) => {
      const tags = cleanIds(link.tags);
      return selectedLinkIds.has(String(link.id)) || tags.some((tagId) => selectedTagIds.has(tagId));
    })
    .map((link: any) => ({
      id: String(link.id),
      title: String(link.title || link.url || "Link"),
      url: String(link.url || ""),
      description: String(link.description || ""),
      updated: String(link.updated || link.created || new Date().toISOString()),
    }))
    .filter((link: any) => link.url);
}

export type LinkRssItem = Awaited<ReturnType<typeof getLinkRssFeedItems>>[number];
