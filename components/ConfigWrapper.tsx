"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ConfigProvider } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";

export default function ConfigWrapper({ children, blurIntensityClass }: { children: ReactNode, blurIntensityClass?: string }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => console.log("Service Worker registered"))
        .catch(err => console.error("Service Worker registration failed:", err));
    }
  }, []);

  // Fetch config function — move it outside the effect so it can be reused
  const fetchConfig = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("pb_token");
      if (!token) {
        router.push("/auth/login");
        return;
      }

      const res = await fetch("/api/v1/config", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status == 401) {router.push("/auth/login"); throw new Error(`Failed to fetch config - Unauthorized. Redirecting to login.`)}

      if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
      const data = await res.json();
      setConfig(data);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch on mount or when pathname changes
  useEffect(() => {
    if (!config && pathname && !pathname.includes("auth")) {
      fetchConfig();
    } else if (!pathname || pathname.includes("auth")) {
      setConfig({});
      setLoading(false);
    }
  }, [pathname]);

  // set accent color
  useEffect(() => {
  const accentColor = config?.appearance?.accentColor || "#4f46e5";
  document.documentElement.style.setProperty("--primary", accentColor);
}, [config]);


  // Handle background image
  useEffect(() => {
    if (!config) return;

    const imgUrl = config?.appearance?.backgroundImageUrl || "/default-background.png";
    const token = localStorage.getItem("pb_token");
    let revokeUrl: string | null = null;

    const loadBackground = async () => {
      try {
        let finalUrl = imgUrl;

        if (imgUrl.startsWith("/api/v1/wallpapers") || imgUrl.includes(window.location.host)) {
          if (!token) return;
          const res = await fetch(imgUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error("Failed to fetch wallpaper with auth");

          const blob = await res.blob();
          finalUrl = URL.createObjectURL(blob);
          revokeUrl = finalUrl;
        }

        const img = new Image();
        img.src = finalUrl;
        img.onload = () => {
          document.body.style.backgroundImage = `url('${finalUrl}')`;
          document.body.style.backgroundSize = "cover";
          document.body.style.backgroundRepeat = "no-repeat";
          document.body.style.backgroundPosition = "center";
        };
      } catch (err) {
        console.error("Error loading background:", err);
      }
    };

    loadBackground();

    return () => {
      document.body.style.backgroundImage = "";
      document.body.style.backgroundSize = "";
      document.body.style.backgroundRepeat = "";
      document.body.style.backgroundPosition = "";

      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl);
      }
    };
  }, [config]);

  if (loading) return <div></div>;
  if (error) return <div>Error loading config: {error}</div>;

  return (
    <ConfigProvider value={{ config, refreshConfig: fetchConfig }}>
      <div className={cn("min-h-screen backdrop-brightness-85", blurIntensityClass ?? "backdrop-blur-[3px]")}>
        {children}
      </div>
    </ConfigProvider>
  );
}
