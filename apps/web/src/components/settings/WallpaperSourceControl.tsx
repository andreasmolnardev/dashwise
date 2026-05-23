"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import useAuth from "@/context/useAuth";

const ROW_CLASS =
  "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent";

const HTTP_URL = /^https?:\/\//i;

type AppearancePreferences = {
  backgroundImageUrl?: string | null;
  backgroundCacheDuration?: number | null;
};

export default function WallpaperSourceControl({
  className,
}: {
  className?: string;
}) {
  const { user, updateUserProperty } = useAuth();
  const [wallpaperUrl, setWallpaperUrl] = useState("");
  const [cacheDuration, setCacheDuration] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const appearance = (user?.appearancePreferences ?? {}) as AppearancePreferences;
    const currentUrl = appearance.backgroundImageUrl ?? "";
    setWallpaperUrl(HTTP_URL.test(currentUrl) ? currentUrl : "");

    const duration = appearance.backgroundCacheDuration;
    setCacheDuration(typeof duration === "number" && duration > 0 ? String(duration) : "");
  }, [user?.appearancePreferences]);

  const saveUpdates = async (updates: Partial<AppearancePreferences>) => {
    setSaving(true);
    try {
      const currentAppearance = (user?.appearancePreferences ?? {}) as AppearancePreferences;
      const updatedAppearance = {
        ...currentAppearance,
        ...updates,
      };
      await updateUserProperty("appearancePreferences", updatedAppearance);
    } catch (err) {
      console.error("Failed to update appearance settings", err);
    } finally {
      setSaving(false);
    }
  };

  const handleUrlSave = async () => {
    const trimmed = wallpaperUrl.trim();
    await saveUpdates({
      backgroundImageUrl: trimmed ? trimmed : null,
    });
  };

  const handleCacheSave = async () => {
    const trimmed = cacheDuration.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    const normalized = parsed && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
    await saveUpdates({
      backgroundCacheDuration: normalized,
    });
    if (normalized === null) {
      setCacheDuration("");
    } else {
      setCacheDuration(String(normalized));
    }
  };

  return (
    <div className={className ?? "space-y-2"}>
      <div className={ROW_CLASS}>
        <p className="font-medium text-foreground">Wallpaper URL</p>
        <Input
          type="url"
          value={wallpaperUrl}
          onChange={(event) => setWallpaperUrl(event.target.value)}
          onBlur={handleUrlSave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleUrlSave();
            }
          }}
          disabled={saving}
          placeholder="https://example.com/wallpaper.jpg"
          className="flex-1 max-w-96"
        />
      </div>

      <div className={ROW_CLASS}>
        <p className="font-medium text-foreground">Cache duration (minutes)</p>
        <Input
          type="number"
          min={1}
          step={1}
          value={cacheDuration}
          onChange={(event) => setCacheDuration(event.target.value)}
          onBlur={handleCacheSave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCacheSave();
            }
          }}
          disabled={saving}
          placeholder="Unlimited"
          className="w-32"
        />
      </div>
    </div>
  );
}
