import { Outlet } from "react-router-dom";
import AuthWrapper from "@/components/AuthWrapper";

export default function SettingsRootLayout() {
  return <AuthWrapper><Outlet /></AuthWrapper>;
}
