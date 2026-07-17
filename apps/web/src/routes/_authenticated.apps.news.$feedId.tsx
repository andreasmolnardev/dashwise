import { createFileRoute } from "@tanstack/react-router";
import NewsPage from "./_authenticated.apps.news.index";

export const Route = createFileRoute("/_authenticated/apps/news/$feedId")({ component: NewsPage });
