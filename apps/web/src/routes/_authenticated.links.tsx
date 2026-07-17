import { Outlet } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";
import LinksLayout from "@/components/links/LinksLayout";

export const Route = createFileRoute("/_authenticated/links")({ component: LinksRootLayout });

export default function LinksRootLayout() {
    return (
        <LinksLayout>
            <Outlet />
        </LinksLayout>
    );
}
