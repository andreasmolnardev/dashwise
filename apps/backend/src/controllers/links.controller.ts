import type { Hono } from "hono";

import { createHomeLinkGroup, createHomeLinkItem, deleteLinkItem, getHomeLinkGroups, getHomeLinks, getLinksCollections, getLinksFolders, getLinksItems, getLinksTags, updateHomeLinkFolderIcon, updateHomeLinkItem } from "@dashwise/sdk/data/links";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

export function registerLinksControllers(app: Hono) {
  app.get("/api/v1/links/collections", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksCollections(userId);
  }));
  app.get("/api/v1/links/home/groups", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinkGroups(userId);
  }));
  app.post("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createHomeLinkGroup(userId, String(body?.name ?? ""));
  }));
  app.put("/api/v1/links/folders/:folderId/icon", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateHomeLinkFolderIcon(userId, String(c.req.param("folderId") ?? ""), body?.data ?? {});
  }));
  app.get("/api/v1/links/home", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinks(userId);
  }));
  app.get("/api/v1/links/folders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksFolders(String(c.req.query("listId") ?? ""));
  }));
  app.get("/api/v1/links/items", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksItems(String(c.req.query("listId") ?? ""), c.req.query("folderId") ?? undefined);
  }));
  app.post("/api/v1/links/items", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createHomeLinkItem(userId, body?.data ?? {});
  }));
  app.put("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateHomeLinkItem(userId, String(c.req.param("linkId") ?? ""), body?.data ?? {});
  }));
  app.delete("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteLinkItem(userId, String(c.req.param("linkId") ?? ""));
  }));
  app.get("/api/v1/links/tags", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksTags();
  }));
}