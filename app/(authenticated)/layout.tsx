import AuthWrapper from "@/components/AuthWrapper";

export default function SettingsRootLayout({ children }: { children: React.ReactNode }) {
  return <AuthWrapper>{children}</AuthWrapper>;
}
