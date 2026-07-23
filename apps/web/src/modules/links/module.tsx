import { lazy } from "react";
import type { DashwiseModule } from "@/platform/modules/types";

const LinksLayout = lazy(() => import("./internal/layout"));
const LinksPage = lazy(() => import("./internal/page"));
const LinksHomePage = lazy(() => import("./internal/home/page"));
const LinksListsPage = lazy(() => import("./internal/lists/page"));
const LinksListDetailPage = lazy(() => import("./internal/lists/[listId]/page"));
const LinksTagsPage = lazy(() => import("./internal/tags/page"));
const LinksTagDetailPage = lazy(() => import("./internal/tags/[tagId]/page"));

export const linksModule = {
  id: "links",
  name: "Links",
  navigation: [{ id: "links", moduleId: "links", label: "Links", path: "/links", order: 10 }],
  routes: [{
    id: "links", moduleId: "links", path: "links", component: LinksLayout,
    meta: { title: "Links", pageKind: "application", surface: "application", pageConfig: { mode: "none" }, showSidebar: true, showHeader: true },
    children: [
      { id: "links-index", moduleId: "links", index: true, component: LinksPage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "links-home", moduleId: "links", path: "home", component: LinksHomePage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "links-lists", moduleId: "links", path: "lists", component: LinksListsPage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "links-list", moduleId: "links", path: "lists/:listId", component: LinksListDetailPage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "links-tags", moduleId: "links", path: "tags", component: LinksTagsPage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "links-tag", moduleId: "links", path: "tags/:tagId", component: LinksTagDetailPage, meta: { title: "Links", pageKind: "application", pageConfig: { mode: "none" } } },
    ],
  }],
} satisfies DashwiseModule;
