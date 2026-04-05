import { Outlet } from "react-router-dom";
import LinksLayout from "@/components/links/LinksLayout";

export default function LinksRootLayout() {
    return (
        <LinksLayout>
            <Outlet />
        </LinksLayout>
    );
}