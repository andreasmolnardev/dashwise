import NotificationsLayoutComponent from "@/components/notifications/NotificationsLayout";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <NotificationsLayoutComponent>
      {children}
    </NotificationsLayoutComponent>
  );
}
