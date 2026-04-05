import { Outlet } from "react-router-dom";
import NotificationsLayoutComponent from "@/components/notifications/NotificationsLayout";

export default function RootLayout() {
  return <NotificationsLayoutComponent><Outlet /></NotificationsLayoutComponent>;
}
