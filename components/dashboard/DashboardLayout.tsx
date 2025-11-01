"use client";

import { useConfig } from "@/context/ConfigContext";
import ClockWidget from "../widgets/ClockWidget";
import SearchBar from "../widgets/SearchBar";
import LinkView from "../widgets/LinkView";
import GlanceableComponent from "../glanceables/Glanceable";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faGear } from "@fortawesome/free-solid-svg-icons";
import PagesTabs from "../PagesTabs";
import UpdateDetailsDialogComponent from "./UpdateDetailsDialog";
import WidgetComponent from "../widgets/Widget";

export default function DashboardLayoutComponent(
  children: React.PropsWithChildren<{}> = {}
) {
  const { config, refreshConfig } = useConfig();
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("pb_token");
    if (!token) {
      router.push("/auth/login");
    }
  }, [router]);

  const token = typeof window !== "undefined" ? localStorage.getItem("pb_token") : null;
  if (!token) return null;

  useEffect(() => {
    router.prefetch("/settings/appearance");
  }, [router]);

  const renderWidgetColumn = (column?: typeof config.widgets[0]) => {
    if (!column) return null;
    return column.map((widget, index) => (
      <WidgetComponent
        key={widget.id || `${widget.type}-${index}`}
        type={widget.type}
        params={widget.properties}
        className="mb-3.5 h-[120px]" 
      />
    ));
  };

  return (
    <div className="grid grid-rows-[1fr_36px] h-screen pt-5 p-3.5 text-(--surface-foreground) bg-(--surface)">
      <main
        className="overflow-hidden grid grid-cols-[25%_1fr_25%] gap-2"
        id="page-content-container"
      >
        <div id="left-widget-panel" className="space-y-3.5">
          {renderWidgetColumn(config?.widgets?.[0])}
        </div>

        <div className="space-y-3.5">
          <section className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center">
            <GlanceableComponent
              type={config?.glanceables?.[0]?.type}
              params={config?.glanceables?.[0]?.properties}
              className="font-medium"
            />
            <ClockWidget
              format={config?.global?.["time-format"] || "24h"}
            />
            <GlanceableComponent
              type={config?.glanceables?.[1]?.type}
              params={config?.glanceables?.[1]?.properties}
              className="font-medium"
            />
          </section>
          <SearchBar useRedirect={true} />
          <LinkView />
          {/* Render middle column widgets */}
          {renderWidgetColumn(config?.widgets?.[1])}
        </div>
        <div id="right-widget-panel" className="space-y-3.5">
          {renderWidgetColumn(config?.widgets?.[2])}
        </div>
      </main>

      <div className="grid grid-cols-[1fr_80%_1fr] items-center" id="page-footer">
        <div id="app-details" className="flex items-center gap-2">
          <img src="/dashwise-icon.png" alt="" className="h-[36px]" />
          <span className="font-semibold">dashwise</span>

          <div className="aspect-square rounded-full frosted w-2 h-2"></div>

          <UpdateDetailsDialogComponent />
        </div>

        <PagesTabs />

        <ul className="flex items-center gap-4 justify-end">
          {(typeof config?.integrations === "object" &&
            !Array.isArray(config?.integrations) &&
            config?.integrations !== null &&
            Object.keys(config?.integrations)
              .map((i: string) => i.toLowerCase())
              .includes("notifications")) && (
              <li>
                <Link
                  href="/notifications"
                  className="frosted p-2 rounded-full group transition-colors duration-200"
                >
                  <FontAwesomeIcon
                    icon={faBell}
                    className="text-(--text-primary) group-hover:text-(--primary) transition-colors duration-200"
                  />
                </Link>
              </li>
            )}

          <li>
            <Link
              href="/settings/appearance"
              prefetch={false}
              className="frosted p-2 rounded-full group transition-colors duration-200"
            >
              <FontAwesomeIcon
                icon={faGear}
                className="text-(--text-primary) group-hover:text-(--primary) transition-colors duration-200"
              />
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
