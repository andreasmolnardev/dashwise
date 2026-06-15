import { Outlet } from "react-router-dom";
import SettingsLayout from "@/components/settings/SettingsLayout";

export default function SettingsRootLayout() {
  return <SettingsLayout><Outlet /></SettingsLayout>;
}