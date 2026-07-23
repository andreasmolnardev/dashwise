import { Outlet } from "react-router-dom";
import NewsLayout from "./NewsLayout";

export default function NewsRootLayout() {
    return (
        <NewsLayout>
            <Outlet />
        </NewsLayout>
    );
}
