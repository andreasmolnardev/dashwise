import { lazy } from "react";
import { Navigate } from "react-router-dom";
import type { DashwiseModule } from "@/platform/modules/types";

const NewsLayout = lazy(() => import("./internal/layout"));
const NewsPage = lazy(() => import("./internal/page"));
const NewsRedirect = () => <Navigate to="/apps/news" replace />;

export const newsModule = {
  id: "news",
  name: "News",
  navigation: [{ id: "news", moduleId: "news", label: "News", path: "/apps/news", order: 40 }],
  routes: [
    {
      id: "news-legacy", moduleId: "news", path: "news", component: NewsRedirect,
      meta: { title: "News", pageKind: "application", pageConfig: { mode: "none" } },
    },
    {
      id: "news", moduleId: "news", path: "apps/news", component: NewsLayout,
      meta: { title: "News", pageKind: "application", surface: "application", pageConfig: { mode: "none" }, showSidebar: true, showHeader: true },
      children: [
        { id: "news-index", moduleId: "news", index: true, component: NewsPage, meta: { title: "News", pageKind: "application", pageConfig: { mode: "none" } } },
        { id: "news-feed", moduleId: "news", path: ":feedId", component: NewsPage, meta: { title: "News", pageKind: "application", pageConfig: { mode: "none" } } },
      ],
    },
  ],
} satisfies DashwiseModule;
