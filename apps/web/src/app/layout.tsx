import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import "./globals.css";

function formatTitleSegment(segment: string) {
  return segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getDocumentTitle(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return "Dashwise";

  if (segments[0] === "auth") {
    if (segments[1] === "login") return "Dashwise Login";
    if (segments[1] === "signup") return "Dashwise Sign Up";
    return "Dashwise Auth";
  }

  if (segments[0] === "apps") {
    if (segments[1] === "news") return "Dashwise News";
    if (segments[1] === "monitoring") return "Dashwise Monitoring";
    return `Dashwise ${formatTitleSegment(segments[1] || segments[0])}`;
  }

  const sectionTitles: Record<string, string> = {
    home: "Home | Dashwise",
    links: "Links | Dashwise",
    notifications: "Notifications | Dashwise",
    settings: "Settings | Dashwise",
    frame: "Frame | Dashwise",
    onboarding: "Onboarding | Dashwise",
    migrate: "Migrate | Dashwise",
  };

  return sectionTitles[segments[0]] || `Dashwise ${formatTitleSegment(segments[0])}`;
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
