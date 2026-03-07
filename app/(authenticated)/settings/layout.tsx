import SettingsLayout from "@/components/settings/SettingsLayout";

export default function SettingsRootLayout({ children }: { children: React.ReactNode }) {
  return (
      <SettingsLayout>{children}</SettingsLayout>
  );
}