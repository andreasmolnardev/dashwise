import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import "./globals.css";
import config from "@/lib/config";

function formatTitleSegment(segment: string) {
  return segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getDocumentTitle(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return config.instance_name || "Dashwise";

  if (segments[0] === "auth") {
    if (segments[1] === "login") return `${config.instance_name || "Dashwise"} Login`;
    if (segments[1] === "signup") return `${config.instance_name || "Dashwise"} Sign Up`;
    return `${config.instance_name || "Dashwise"} Auth`;
  }

  if (segments[0] === "apps") {
    if (segments[1] === "news") return `${config.instance_name || "Dashwise"} News`;
    if (segments[1] === "monitoring") return `${config.instance_name || "Dashwise"} Monitoring`;
    return `${config.instance_name || "Dashwise"} ${formatTitleSegment(segments[1] || segments[0])}`;
  }

  console.log(config.instance_name);

  const sectionTitles: Record<string, string> = {
    home: "Home | " + (config.instance_name || "Dashwise"),
    links: "Links | " + (config.instance_name || "Dashwise"),
    notifications: "Notifications | " + (config.instance_name || "Dashwise"),
    settings: "Settings | " + (config.instance_name || "Dashwise"),
    frame: "Frame | " + (config.instance_name || "Dashwise"),
    onboarding: "Onboarding | " + (config.instance_name || "Dashwise"),
    migrate: "Migrate | " + (config.instance_name || "Dashwise"),
  };

  return sectionTitles[segments[0]] || `${config.instance_name || "Dashwise"} ${formatTitleSegment(segments[0])}`;
}

export default function RootLayout() {
  const location = useLocation();
  const bootFlagKey = "dashwise:booted";
  const windowInitialized = (() => {
    if (typeof window === "undefined") return false;

    const booted = window.sessionStorage.getItem(bootFlagKey) === "1";

    if (!booted) {
      window.sessionStorage.setItem(bootFlagKey, "1");
    }

    return booted;
  })();

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (
      location.pathname === "/apps/monitoring/ssh" ||
      location.pathname.startsWith("/apps/monitoring/ssh/")
    ) {
      return;
    }

    document.title = getDocumentTitle(location.pathname);
  }, [location.pathname]);

  return (
    <Suspense
      fallback={
        windowInitialized ? null : (
          <div
            style={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              color: "rgba(255, 255, 255, 0.72)",
              background: "#0b1020",
              fontSize: 14,
            }}
          >
            Loading dashwise...
          </div>
        )
      }
    >
      <Outlet />
    </Suspense>
  );
}
