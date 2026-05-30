import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import "./globals.css";

export default function RootLayout() {
  return (
    <Suspense
      fallback={
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
      }
    >
      <Outlet />
    </Suspense>
  );
}
