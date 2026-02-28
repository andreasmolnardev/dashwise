"use client";

import { ReactNode, useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { usePathname, useRouter } from "next/navigation";
import { ConfigProvider } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/apiClient";

type ThemeMode = "system" | "dark" | "light";

function applyThemeClasses(themeMode: ThemeMode, frostedAppearance: ThemeMode = themeMode) {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
  const resolvedFrosted =
    frostedAppearance === "system"
      ? media.matches
        ? "dark"
        : "light"
      : frostedAppearance;

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;

  root.classList.remove("frosted-theme-dark", "frosted-theme-light");
  root.classList.add(resolvedFrosted === "dark" ? "frosted-theme-dark" : "frosted-theme-light");
}

export default function ConfigWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkThemeActive, setIsDarkThemeActive] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const themeMode: ThemeMode = config?.appearance?.themeMode ?? "system";
    const frostedAppearance: ThemeMode = config?.appearance?.frostedAppearance ?? themeMode;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      applyThemeClasses(themeMode, frostedAppearance);
      const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      setIsDarkThemeActive(resolvedTheme === "dark");
    };
    apply();

    const shouldWatchSystem = themeMode === "system" || frostedAppearance === "system";
    if (!shouldWatchSystem) return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [config?.appearance?.themeMode, config?.appearance?.frostedAppearance]);

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
  const darkModeBrightness = config?.appearance?.wallpaperFilters?.darkModeBrightness ?? 0; // extra darken percent (0-50)
  const appliedBrightness = isDarkThemeActive
    ? Math.max(0, brightness - Math.max(0, Math.min(50, darkModeBrightness)))
    : brightness;


  return (
    <ConfigProvider value={{ config, refreshConfig: fetchConfig }}>
      <div
        className={cn("min-h-screen overflow-hidden")}
        style={{
          backdropFilter: `blur(${blur}px) brightness(${appliedBrightness}%)`,
          WebkitBackdropFilter: `blur(${blur}px) brightness(${appliedBrightness}%)`,
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
}
