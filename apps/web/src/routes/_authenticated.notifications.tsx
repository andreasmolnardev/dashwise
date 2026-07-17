import { Outlet } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/notifications")({ component: RootLayout });

export default function RootLayout() {
  return <Outlet />;
}
