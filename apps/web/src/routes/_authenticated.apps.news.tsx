import { Outlet } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";
import NewsLayout from "@/components/news/NewsLayout";

export const Route = createFileRoute("/_authenticated/apps/news")({ component: NewsRootLayout });

export default function NewsRootLayout() {
    return (
        <NewsLayout>
            <Outlet />
        </NewsLayout>
    );
}
