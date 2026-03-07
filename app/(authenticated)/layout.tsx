import ConfigWrapper from "@/components/ConfigWrapper";

export default function SettingsRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfigWrapper>
      {children}
    </ConfigWrapper>
  );
}
