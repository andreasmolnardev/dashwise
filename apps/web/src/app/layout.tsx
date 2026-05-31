import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import "./globals.css";

export default function RootLayout() {
  const bootFlagKey = "dashwise:booted";
  const windowInitialized = (() => {
    if (typeof window === "undefined") return false;

    const booted = window.sessionStorage.getItem(bootFlagKey) === "1";

    if (!booted) {
      window.sessionStorage.setItem(bootFlagKey, "1");
    }

    return booted;
  })();

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
