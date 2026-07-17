import { Outlet } from "react-router-dom";
import { createFileRoute } from "@tanstack/react-router";
import SettingsLayout from "@/components/settings/SettingsLayout";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsRootLayout });

export default function SettingsRootLayout() {
  return <SettingsLayout><Outlet /></SettingsLayout>;
}
