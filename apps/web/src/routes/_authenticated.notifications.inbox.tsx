import { Navigate } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/notifications/inbox")({ component: NotificationsInboxRedirect });

export default function NotificationsInboxRedirect() {
    return <Navigate to="/notifications" replace />;
}
