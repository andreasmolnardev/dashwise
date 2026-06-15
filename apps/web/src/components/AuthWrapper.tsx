"use client";
import { ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { validateAuthTokenAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import { cn } from "@/lib/utils";
import { fetchWallpaperBlob } from "@/lib/apiClient";
import { LocalizationProvider } from "@/context/LocalizationContext";
import { normalizeWallpaperFilters } from "./settings/wallpaperFilterDefaults";

type AuthWrapperProps = {
  children: ReactNode;
};

type ThemeMode = "light" | "dark" | "system";

export default function AuthWrapper({ children }: AuthWrapperProps) {
  const navigate = useNavigate();
  const { token, user, setAuth, logout } = useAuth();
  const location = useLocation();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!token) {
      navigate("/auth/login", { replace: true });
    }
  }, [navigate, token]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const refreshUser = async () => {
      try {
        const response = await validateAuthTokenAction({ token });
        if (cancelled) return;

        if (response?.user) {
          setAuth(response.user, response.token ?? token);
        }
      } catch (error: any) {
        if (cancelled) return;

        if (error?.status === 401) {
          logout();
          navigate("/auth/login", { replace: true });
        } else {
          console.error("Failed to refresh authenticated user:", error);
        }
      }
    };

    refreshUser();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, logout, navigate, setAuth, token]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const themeMode = (user?.appearancePreferences?.themeMode as ThemeMode | undefined) ?? "light";

    const applyTheme = () => {
      const resolvedTheme = themeMode === "system"
        ? (media.matches ? "dark" : "light")
        : themeMode;

      root.classList.toggle("dark", resolvedTheme === "dark");
      root.style.colorScheme = resolvedTheme;

      root.classList.remove("frosted-theme-dark", "frosted-theme-light");
      root.classList.add(resolvedTheme === "dark" ? "frosted-theme-dark" : "frosted-theme-light");
    };

    applyTheme();

    if (themeMode !== "system") return;

    const handleSystemThemeChange = () => applyTheme();
    media.addEventListener("change", handleSystemThemeChange);
    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [user?.appearancePreferences?.themeMode]);

  // --- Accent color --- MOVED UP before any conditional returns
  useEffect(() => {
    const accentColor = user?.appearancePreferences?.accentColor || "#4f46e5";
    document.documentElement.style.setProperty("--primary", accentColor);
  }, [user]);

  // --- Background image --- MOVED UP before any conditional returns
  useEffect(() => {
    if (!user?.appearancePreferences) return;

    const imgUrl =
      user.appearancePreferences.backgroundImageUrl || "/default-background.png";
    const tokenToUse = token;
    let revokeUrl: string | null = null;

    const loadBackground = async () => {
      try {
        let finalUrl = imgUrl;
        if (
          imgUrl.startsWith("/api/v1/wallpapers") ||
          imgUrl.includes(window.location.host)
        ) {
          if (!tokenToUse) return;
          const blob = await fetchWallpaperBlob(imgUrl, tokenToUse);
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
  }, [user, token]);


  if (!isMounted) {
    return (
      <LocalizationProvider>
        <div className={cn("min-h-screen overflow-hidden")}>{children}</div>
      </LocalizationProvider>
    );
  }

  if (!token) {
    return null;
  }

  const wallpaperFilters = normalizeWallpaperFilters(user?.appearancePreferences?.wallpaperFilters);
  const blur = wallpaperFilters.blur;
  const brightness = wallpaperFilters.brightness;
  const darkModeBrightness = wallpaperFilters.darkModeBrightness;
  const appliedBrightness = Math.max(
    0,
    brightness - Math.max(0, Math.min(50, darkModeBrightness))
  );

  return (
    <LocalizationProvider>
      <div
        className={cn("min-h-screen overflow-hidden overscroll-none")}
        style={{
          backdropFilter: `blur(${blur}px) brightness(${appliedBrightness}%)`,
          WebkitBackdropFilter: `blur(${blur}px) brightness(${appliedBrightness}%)`,
        }}
      >
        {children}
      </div>
    </LocalizationProvider>
  );
}