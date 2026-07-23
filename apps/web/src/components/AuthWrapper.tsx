"use client";
import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { validateAuthTokenAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import { cn } from "@/lib/utils";
import { fetchWallpaperBlob } from "@/lib/apiClient";
import { LocalizationProvider } from "@/context/LocalizationContext";
import { ActivityProvider } from "@/context/ActivityContext";
import { normalizeWallpaperFilters } from "./settings/wallpaperFilterDefaults";

type AuthWrapperProps = {
  children: ReactNode;
};

type ThemeMode = "light" | "dark" | "system";

export default function AuthWrapper({ children }: AuthWrapperProps) {
  const navigate = useNavigate();
  const { token, user, setAuth, logout } = useAuth();
  const [isMounted, setIsMounted] = useState(false);
  const authValidation = useQuery({
    queryKey: ["auth", "validate", token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => validateAuthTokenAction({ token }),
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!token) {
      navigate("/auth/login", { replace: true });
    }
  }, [navigate, token]);

  useEffect(() => {
    if (authValidation.data?.user) {
      setAuth(authValidation.data.user, authValidation.data.token ?? token);
    }
  }, [authValidation.data, setAuth, token]);

  useEffect(() => {
    if (!authValidation.error) return;
    const status = (authValidation.error as Error & { status?: number }).status;
    if (status === 401) {
      logout();
      navigate("/auth/login", { replace: true });
    } else {
      console.error("Failed to refresh authenticated user:", authValidation.error);
    }
  }, [authValidation.error, logout, navigate]);

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

    const rawImgUrl = user.appearancePreferences.backgroundImageUrl || "/dashboard-wallpaper.png";
    const imgUrl = rawImgUrl.startsWith("/assets/") ? rawImgUrl.replace(/^\/assets\//, "/") : rawImgUrl;
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
        <ActivityProvider>
          <div className={cn("min-h-screen overflow-hidden")}>{children}</div>
        </ActivityProvider>
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
        <ActivityProvider>{children}</ActivityProvider>
      </div>
    </LocalizationProvider>
  );
}
