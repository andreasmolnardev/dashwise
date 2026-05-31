"use client";

import React, { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import useAuth from "@/context/useAuth";
import {
  DEFAULT_WALLPAPER_FILTERS,
  blurToPercent,
  normalizeWallpaperFilters,
  percentToBlur,
} from "./wallpaperFilterDefaults";

export default function WallpaperBlurSliderComponent({ className }: { className?: string }) {
  const { user, updateUserProperty } = useAuth();
  
  const [percent, setPercent] = useState(blurToPercent(DEFAULT_WALLPAPER_FILTERS.blur)); // slider percentage
  const [previewBlur, setPreviewBlur] = useState(DEFAULT_WALLPAPER_FILTERS.blur); // px
  const [saving, setSaving] = useState(false);

  // Load current blur from config on mount
  useEffect(() => {
    const appearance = user?.appearancePreferences;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    setPercent(blurToPercent(filters.blur));
    setPreviewBlur(filters.blur);
  }, [user?.appearancePreferences]);

  // Preview on drag
  function handlePreview(pxValue: number) {
    setPreviewBlur(pxValue);
    const appearance = user?.appearancePreferences;
    const filters = normalizeWallpaperFilters(appearance?.wallpaperFilters);
    document.body.style.backdropFilter = `blur(${pxValue}px) brightness(${filters.brightness / 100})`;
  }

  // Save on release
  async function handleSave(pxValue: number) {
    setSaving(true);
    try {
      const currentAppearance = user?.appearancePreferences || {};
      const currentFilters = normalizeWallpaperFilters(currentAppearance.wallpaperFilters);
      const updatedAppearance = {
        ...currentAppearance,
        wallpaperFilters: {
          ...currentFilters,
          blur: pxValue,
        },
      };

      await updateUserProperty("appearancePreferences", updatedAppearance);
    } catch (err) {
      console.error("Error updating blur:", err);
    } finally {
      setSaving(false);
    }
  }

  const blurPx = percentToBlur(percent).toFixed(1);

  return (
    <div
      className={
        className ??
        "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent"
      }
    >
      {/* Label + tooltip */}
      <div className="flex items-center gap-1 min-w-45">
        <p className="font-medium text-foreground">Blur</p>
      </div>

      {/* Slider */}
      <div className="flex-1 flex items-center gap-3 max-w-76">
        <Slider
          value={[percent]}
          max={100}
          step={1}
          disabled={saving}
          onValueChange={([v]) => {
            setPercent(v);
            const newValue = percentToBlur(v);
            handlePreview(newValue);
            handleSave(newValue);
          }}

          onValueCommit={([v]) => {
            const newValue = percentToBlur(v);
            handleSave(newValue);
          }}
          className="flex-1"
        />
        {/* Percentage + px */}
        <span className="min-w-12.5 text-right text-medium">
          {blurPx}px
        </span>
      </div>
    </div>
  );
}
