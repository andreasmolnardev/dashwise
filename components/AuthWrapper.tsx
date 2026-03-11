"use client";
import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useAuth from "@/context/useAuth";
import { cn } from "@/lib/utils";
import { LocalizationProvider } from "@/context/LocalizationContext";

type AuthWrapperProps = {
  children: ReactNode;
};

export default function AuthWrapper({ children }: AuthWrapperProps) {
  const router = useRouter();
  const { token, user } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!token) {
      router.replace("/auth/login");
    }
  }, [router, token]);

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
          const res = await fetch(imgUrl, {
            headers: { Authorization: `Bearer ${tokenToUse}` },
          });
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

  const blur = user?.appearancePreferences?.wallpaperFilters?.blur ?? 3;
  const brightness = user?.appearancePreferences?.wallpaperFilters?.brightness ?? 85;
  const darkModeBrightness =
    user?.appearancePreferences?.wallpaperFilters?.darkModeBrightness ?? 0;
  const appliedBrightness = Math.max(
    0,
    brightness - Math.max(0, Math.min(50, darkModeBrightness))
  );

  return (
    <LocalizationProvider>
      <div
        className={cn("min-h-screen overflow-hidden")}
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