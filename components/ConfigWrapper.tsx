"use client";

import { ReactNode, useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { usePathname, useRouter } from "next/navigation";
import { ConfigProvider } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/apiClient";

export default function ConfigWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // --- Service worker registration ---
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => console.log("Service Worker registered"))
        .catch((err) => console.error("Service Worker registration failed:", err));
    }
  }, []);

  const { token } = useAuth();

  // --- Fetch config ---
  const fetchConfig = async () => {
    try {
      setLoading(true);
      if (!token) {
        router.push("/auth/login");
        return;
      }

        try {
        const data = await getConfig({ token });
        setConfig(data);
      } catch (err: any) {
        if (err?.status === 401) {
          router.push("/auth/login");
          throw new Error("Unauthorized");
        }
        throw err;
      }
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // --- Fetch config on mount or when path changes ---
  useEffect(() => {
    if (!config && pathname && !pathname.includes("auth")) {
      fetchConfig();
    } else if (!pathname || pathname.includes("auth")) {
      setConfig({});
      setLoading(false);
    }
  }, [pathname]);

  // --- Accent color ---
  useEffect(() => {
    const accentColor = config?.appearance?.accentColor || "#4f46e5";
    document.documentElement.style.setProperty("--primary", accentColor);
  }, [config]);

  // --- Wallpaper loading ---
  useEffect(() => {
    if (!config) return;

    const imgUrl = config?.appearance?.backgroundImageUrl || "/default-background.png";
    const tokenToUse = token;
    let revokeUrl: string | null = null;

    const loadBackground = async () => {
      try {
        let finalUrl = imgUrl;

        if (imgUrl.startsWith("/api/v1/wallpapers") || imgUrl.includes(window.location.host)) {
          if (!tokenToUse) return;
          const res = await fetch(imgUrl, { headers: { Authorization: `Bearer ${tokenToUse}` } });
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

      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [config]);

  if (loading) return <div></div>;
  if (error) return <div>Error loading config: {error}</div>;

  // Wallpaper blur + brightness from config
  const blur = config?.appearance?.wallpaperFilters?.blur ?? 3; // px
  const brightness = config?.appearance?.wallpaperFilters?.brightness ?? 85; // percent


  return (
    <ConfigProvider value={{ config, refreshConfig: fetchConfig }}>
      <div
        className={cn("min-h-screen overflow-hidden")}
        style={{
          backdropFilter: `blur(${blur}px) brightness(${brightness}%)`,
          WebkitBackdropFilter: `blur(${blur}px) brightness(${brightness}%)`,
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
}
