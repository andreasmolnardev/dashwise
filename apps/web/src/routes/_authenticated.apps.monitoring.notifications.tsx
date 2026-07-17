import { createFileRoute } from "@tanstack/react-router";
import NotificationsPage from "@/components/notifications/NotificationsPage";

export const Route = createFileRoute("/_authenticated/apps/monitoring/notifications")({ component: NotificationsPage });
export default NotificationsPage;
