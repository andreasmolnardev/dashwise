"use client";

import React, { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";
import {
  DEFAULT_WALLPAPER_FILTERS,
  brightnessToPercent,
  darkModeBrightnessToPercent,
  normalizeWallpaperFilters,
  percentToBrightness,
} from "./wallpaperFilterDefaults";

export default function WallpaperBrightnessSliderComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = usePageConfig();
  const { user, updateUserProperty } = useAuth();

  const [percent, setPercent] = useState(brightnessToPercent(DEFAULT_WALLPAPER_FILTERS.brightness));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const appearance = user?.appearancePreferences || config?.appearance;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    setPercent(brightnessToPercent(filters.brightness));
  }, [user, config]);

  function handlePreview(value: number) {
    const appearance = user?.appearancePreferences || config?.appearance;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    const blur = filters.blur;
    const darkModeBrightness = darkModeBrightnessToPercent(filters.darkModeBrightness);
    const appliedBrightness = Math.max(0, value - darkModeBrightness);
    document.body.style.backdropFilter = `brightness(${appliedBrightness}%) blur(${blur}px)`;
  }

  async function handleSave(value: number) {
    setSaving(true);
    try {
      const currentAppearance = user?.appearancePreferences || config?.appearance || {};
      const currentFilters = normalizeWallpaperFilters(currentAppearance.wallpaperFilters);
      const updatedAppearance = {
        ...currentAppearance,
        wallpaperFilters: {
          ...currentFilters,
          brightness: value,
        },
      };

      await updateUserProperty("appearancePreferences", updatedAppearance);
      refreshConfig();
    } catch (err) {
      console.error("Error updating brightness:", err);
    } finally {
      setSaving(false);
    }
  }

  const brightnessValue = percentToBrightness(percent).toFixed(0);

  return (
    <div
      className={cn(
        "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent",
        className
      )}
    >
      <div className="flex items-center gap-1 min-w-[180px]">
        <p className="font-medium text-foreground">Darken/Brighten</p>
      </div>

      <div className="flex-1 flex items-center gap-3 max-w-76">
        <Slider
          value={[percent]}
          max={100}
          step={1}
          disabled={saving}
          onValueChange={([v]) => {
            setPercent(v);
            const newValue = percentToBrightness(v);
            handlePreview(newValue);
            handleSave(newValue);
          }}
          onValueCommit={([v]) => {
            const newValue = percentToBrightness(v);
            handleSave(newValue);
          }}
          className="flex-1"
        />
        <span className="min-w-[50px] text-right text-medium">{brightnessValue}%</span>
      </div>
    </div>
  );
}

export function WallpaperBrightnessDarkModeSliderComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = usePageConfig();
  const { user, updateUserProperty } = useAuth();

  const [percent, setPercent] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const appearance = user?.appearancePreferences || config?.appearance;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    setPercent(darkModeBrightnessToPercent(filters.darkModeBrightness));
  }, [user, config]);

  function handlePreview(value: number) {
    const appearance = user?.appearancePreferences || config?.appearance;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    const blur = filters.blur;
    const brightness = filters.brightness;
    const appliedBrightness = Math.max(0, brightness - value);
    document.body.style.backdropFilter = `brightness(${appliedBrightness}%) blur(${blur}px)`;
  }

  async function handleSave(value: number) {
    setSaving(true);
    try {
      const currentAppearance = user?.appearancePreferences || config?.appearance || {};
      const currentFilters = normalizeWallpaperFilters(currentAppearance.wallpaperFilters);
      const updatedAppearance = {
        ...currentAppearance,
        wallpaperFilters: {
          ...currentFilters,
          darkModeBrightness: value,
        },
      };

      await updateUserProperty("appearancePreferences", updatedAppearance);
      refreshConfig();
    } catch (err) {
      console.error("Error updating dark mode brightness:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent",
        className
      )}
    >
      <div className="flex items-center gap-1 min-w-[180px]">
        <p className="font-medium text-foreground">Extra darken in dark mode</p>
      </div>

      <div className="flex-1 flex items-center gap-3 max-w-76">
        <Slider
          value={[percent]}
          min={0}
          max={50}
          step={1}
          disabled={saving}
          onValueChange={([v]) => {
            setPercent(v);
            handlePreview(v);
            handleSave(v);
          }}
          onValueCommit={([v]) => {
            handleSave(v);
          }}
          className="flex-1"
        />
        <span className="min-w-[50px] text-right text-medium">{percent}%</span>
      </div>
    </div>
  );
}
