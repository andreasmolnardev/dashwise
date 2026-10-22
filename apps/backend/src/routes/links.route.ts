import { Hono } from "hono";

import { createCollection, createCollectionLinkItem, createHomeLinkGroup, createHomeLinkItem, createLinkTag, createLinksFolder, deleteHomeLinkGroup, deleteLinkItem, deleteUnusedHomeLinkGroups, getHomeLinkGroups, getHomeLinks, getLinksCollections, getLinksFolders, getLinksItems, getLinksTags, renameHomeLinkGroup, reorderLinks, updateCollection, updateHomeLinkFolderIcon, updateHomeLinkItem, updateLinkTag, wipeUserLinks } from "../lib/data/links";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";
import { config } from "../lib/config";
import { ApiActionError } from "../lib/data/auth";
import { getLinkMetadata } from "../lib/api/tools/linkMetadata";
import { createLinkRssFeed, deleteLinkRssFeed, getLinkRssFeedForRequest, getLinkRssFeedItems, listLinkRssFeeds, updateLinkRssFeed, type LinkRssFeedInput } from "../lib/data/link-rss-feeds";

const linksRoute = new Hono();

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function feedInput(body: any): LinkRssFeedInput {
  return {
    name: String(body?.name ?? ""),
    listId: String(body?.listId ?? ""),
    tagIds: Array.isArray(body?.tagIds) ? body.tagIds.map(String) : [],
    linkIds: Array.isArray(body?.linkIds) ? body.linkIds.map(String) : [],
    requiresAuth: body?.requiresAuth === true,
  };
}

linksRoute.get("/api/v1/links/rss/:feedId", async (c) => {
  try {
    const feed = await getLinkRssFeedForRequest(String(c.req.param("feedId") ?? ""));
    if (feed.requiresAuth) {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      if (userId !== feed.user) return c.json({ error: "Unauthorized" }, 401);
    }
    const items = await getLinkRssFeedItems(feed);
    const baseUrl = new URL(c.req.url).origin;
    const xmlItems = items.map((item) => `  <item>\n    <title>${escapeXml(item.title)}</title>\n    <link>${escapeXml(item.url)}</link>\n    <guid isPermaLink="false">${escapeXml(item.id)}</guid>\n    <description>${escapeXml(item.description)}</description>\n    <pubDate>${new Date(item.updated).toUTCString()}</pubDate>\n  </item>`).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${escapeXml(feed.name)}</title>\n  <link>${escapeXml(baseUrl)}</link>\n  <description>Links from Dashwise</description>\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${xmlItems}\n</channel>\n</rss>`;
    return c.body(xml, 200, {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": feed.requiresAuth ? "private, no-store" : "public, max-age=300",
    });
  } catch (error) {
    const response = error instanceof ApiActionError
      ? { status: error.status, body: error.body ?? { error: error.message } }
      : { status: 500, body: { error: error instanceof Error ? error.message : "Internal Server Error" } };
    return c.json(response.body, response.status as any);
  }
});

linksRoute
  .get("/api/v1/links/rss", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return listLinkRssFeeds(userId);
  }))
  .post("/api/v1/links/rss", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createLinkRssFeed(userId, feedInput(body));
  }))
  .put("/api/v1/links/rss/:feedId", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateLinkRssFeed(userId, String(c.req.param("feedId") ?? ""), feedInput(body));
  }))
  .delete("/api/v1/links/rss/:feedId", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteLinkRssFeed(userId, String(c.req.param("feedId") ?? ""));
  }))
  .get("/api/v1/links/metadata", withJson(async (c) => {
    await requireAuth({ token: readAuthToken(c) });
    return getLinkMetadata(String(c.req.query("url") ?? "").trim());
  }))
  .get("/api/v1/links/collections", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksCollections(userId);
  }))
  .post("/api/v1/links/collections", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createCollection(userId, {
      name: String(body?.name ?? ""),
      description: typeof body?.description === "string" ? body.description : undefined,
    });
  }))
  .put("/api/v1/links/collections/:collectionId", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateCollection(userId, String(c.req.param("collectionId") ?? ""), body?.data ?? {});
  }))
  .post("/api/v1/links/home/groups/cleanup", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteUnusedHomeLinkGroups(userId);
  }))
  .get("/api/v1/links/home/groups", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinkGroups(userId);
  }))
  .post("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createHomeLinkGroup(userId, String(body?.name ?? ""));
  }))
  .put("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return renameHomeLinkGroup(userId, String(body?.currentName ?? ""), String(body?.name ?? ""));
  }))
  .delete("/api/v1/links/home/groups/:groupName", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteHomeLinkGroup(userId, String(c.req.param("groupName") ?? ""));
  }))
  .put("/api/v1/links/folders/:folderId/icon", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateHomeLinkFolderIcon(userId, String(c.req.param("folderId") ?? ""), body?.data ?? {});
  }))
  .get("/api/v1/links/home", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinks(userId);
  }))
  .get("/api/v1/links/folders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksFolders(userId, String(c.req.query("listId") ?? ""));
  }))
  .post("/api/v1/links/folders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createLinksFolder(userId, {
      list: String(body?.list ?? ""),
      name: String(body?.name ?? ""),
      parentFolder: typeof body?.parentFolder === "string" ? body.parentFolder : undefined,
      icon: typeof body?.icon === "string" ? body.icon : undefined,
    });
  }))
  .get("/api/v1/links/items", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksItems(userId, String(c.req.query("listId") ?? ""), c.req.query("folderId") ?? undefined);
  }))
  .post("/api/v1/links/items", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const data = body ?? {};

    if (typeof data.collection === "string" && data.collection.trim()) {
      return createCollectionLinkItem(userId, data);
    }

    return createHomeLinkItem(userId, data);
  }))
  .put("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateHomeLinkItem(userId, String(c.req.param("linkId") ?? ""), body ?? {});
  }))
  .delete("/api/v1/links/items/:linkId", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteLinkItem(userId, String(c.req.param("linkId") ?? ""));
  }))
  .delete("/api/v1/links/dev/user-links", withJson(async (c) => {
    if (config.ENVIRONMENT !== "dev") {
      throw new ApiActionError("Not found", 404, { error: "Not found" });
    }
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return wipeUserLinks(userId);
  }))
  .post("/api/v1/links/reorder", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return reorderLinks(userId, body?.items ?? []);
  }))
  .get("/api/v1/links/tags", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksTags(userId);
  }))
  .post("/api/v1/links/tags", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createLinkTag(userId, {
      name: String(body?.name ?? ""),
      color: typeof body?.color === "string" ? body.color : undefined,
    });
  }))
  .put("/api/v1/links/tags/:tagId", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateLinkTag(userId, String(c.req.param("tagId") ?? ""), body?.data ?? {});
  }));

export default linksRoute;
