import { Icon } from "@iconify-icon/react";
import LinksHtmlTransfer from "@/components/settings/LinksHtmlTransfer";

type EmptyAppSectionProps = {
  title: string;
  icon: string;
  description: string;
};

function EmptyAppSection({ title, icon, description }: EmptyAppSectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Icon icon={icon} />
        {title}
      </h2>
      <div className="frosted rounded-lg border border-white/10 p-4 text-sm text-white/65">
        {description}
      </div>
    </section>
  );
}

export default function AppsSettingsPage() {
  return (
    <main className="max-w-5xl space-y-8 p-2 pb-8">
      <div>
        <h1 className="mb-2 text-3xl font-semibold">Apps Settings</h1>
        <p className="text-white/65">Manage settings and data for the apps in your workspace.</p>
      </div>

      <EmptyAppSection
        title="News"
        icon="fa6-solid:newspaper"
        description="News settings will be available here soon. Feed subscriptions, saved articles, and default feed behavior are good candidates for this section."
      />

      <EmptyAppSection
        title="Notifications"
        icon="fa6-solid:bell"
        description="Notification settings will be available here soon. Delivery defaults, topic management, and notification retention are planned for this section."
      />

      <EmptyAppSection
        title="Monitoring"
        icon="fa6-solid:chart-line"
        description="Monitoring settings will be available here soon. Polling defaults, history retention, and status-change notification rules are good candidates for this section."
      />

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Icon icon="fa6-solid:link" />
          Links
        </h2>
        <LinksHtmlTransfer />
      </section>
    </main>
  );
}
