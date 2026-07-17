import { Outlet } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";
import AuthWrapper from "@/components/AuthWrapper";

export const Route = createFileRoute("/_authenticated")({ component: SettingsRootLayout });

export default function SettingsRootLayout() {
  return <AuthWrapper><Outlet /></AuthWrapper>;
}
