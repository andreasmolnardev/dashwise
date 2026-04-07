import { Outlet } from "react-router-dom";
import NewsLayout from "@/components/news/NewsLayout";

export default function NewsRootLayout() {
    return (
        <NewsLayout>
            <Outlet />
        </NewsLayout>
    );
}