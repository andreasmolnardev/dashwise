import { Hono } from "hono";

import { createCollection, createCollectionLinkItem, createHomeLinkGroup, createHomeLinkItem, createLinkTag, createLinksFolder, deleteLinkItem, getHomeLinkGroups, getHomeLinks, getLinksCollections, getLinksFolders, getLinksItems, getLinksTags, reorderLinks, updateCollection, updateHomeLinkFolderIcon, updateHomeLinkItem, updateLinkTag } from "../lib/data/links";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const linksRoute = new Hono();

linksRoute
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
  .get("/api/v1/links/home/groups", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinkGroups(userId);
  }))
  .post("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createHomeLinkGroup(userId, String(body?.name ?? ""));
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
  .post("/api/v1/links/reorder", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return reorderLinks(userId, body?.items ?? []);
  }))
  .get("/api/v1/links/tags", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksTags();
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
