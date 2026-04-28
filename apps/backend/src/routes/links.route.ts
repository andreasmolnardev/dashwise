import { Hono } from "hono";

import { createCollection, createCollectionLinkItem, createHomeLinkGroup, createHomeLinkItem, createLinkTag, createLinksFolder, deleteLinkItem, getHomeLinkGroups, getHomeLinks, getLinksCollections, getLinksFolders, getLinksItems, getLinksTags, updateCollection, updateHomeLinkFolderIcon, updateHomeLinkItem, updateLinkTag } from "@dashwise/sdk/data/links";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const linksRoute = new Hono();
  linksRoute.get("/api/v1/links/collections", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksCollections(userId);
  }));
  linksRoute.post("/api/v1/links/collections", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createCollection(userId, {
      name: String(body?.name ?? ""),
      description: typeof body?.description === "string" ? body.description : undefined,
    });
  }));
  linksRoute.put("/api/v1/links/collections/:collectionId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateCollection(userId, String(c.req.param("collectionId") ?? ""), body?.data ?? {});
  }));
  linksRoute.get("/api/v1/links/home/groups", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinkGroups(userId);
  }));
  linksRoute.post("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createHomeLinkGroup(userId, String(body?.name ?? ""));
  }));
  linksRoute.put("/api/v1/links/folders/:folderId/icon", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateHomeLinkFolderIcon(userId, String(c.req.param("folderId") ?? ""), body?.data ?? {});
  }));
  linksRoute.get("/api/v1/links/home", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinks(userId);
  }));
  linksRoute.get("/api/v1/links/folders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksFolders(String(c.req.query("listId") ?? ""));
  }));
  linksRoute.post("/api/v1/links/folders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createLinksFolder(userId, {
      list: String(body?.list ?? ""),
      name: String(body?.name ?? ""),
      parentFolder: typeof body?.parentFolder === "string" ? body.parentFolder : undefined,
    });
  }));
  linksRoute.get("/api/v1/links/items", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksItems(String(c.req.query("listId") ?? ""), c.req.query("folderId") ?? undefined);
  }));
  linksRoute.post("/api/v1/links/items", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    const data = body?.data ?? {};

    if (typeof data.collection === "string" && data.collection.trim()) {
      return createCollectionLinkItem(userId, data);
    }

    return createHomeLinkItem(userId, data);
  }));
  linksRoute.put("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateHomeLinkItem(userId, String(c.req.param("linkId") ?? ""), body?.data ?? {});
  }));
  linksRoute.delete("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteLinkItem(userId, String(c.req.param("linkId") ?? ""));
  }));
  linksRoute.get("/api/v1/links/tags", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksTags();
  }));
  linksRoute.post("/api/v1/links/tags", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createLinkTag(userId, {
      name: String(body?.name ?? ""),
      color: typeof body?.color === "string" ? body.color : undefined,
    });
  }));
  linksRoute.put("/api/v1/links/tags/:tagId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateLinkTag(userId, String(c.req.param("tagId") ?? ""), body?.data ?? {});
  }));

export default linksRoute;
