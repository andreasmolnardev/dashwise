"use client";

import React, { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";

export default function WallpaperBlurSliderComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = usePageConfig();
  const { user, updateUserProperty } = useAuth();
  
  const [percent, setPercent] = useState(50); // slider percentage
  const [previewBlur, setPreviewBlur] = useState(3); // px
  const [saving, setSaving] = useState(false);

  // Load current blur from config on mount
  useEffect(() => {
    const appearance = user?.appearancePreferences || config?.appearance;
    const current = appearance?.wallpaperFilters?.blur;
    if (typeof current === "number") {
      const newPercent = ((current - 1) / (25 - 1)) * 100;
      setPercent(Math.round(newPercent));
      setPreviewBlur(current);
    }
  }, [user, config]);

  // Preview on drag
  function handlePreview(pxValue: number) {
    setPreviewBlur(pxValue);
    const appearance = user?.appearancePreferences || config?.appearance;
    const brightness = appearance?.wallpaperFilters?.brightness;
    document.body.style.backdropFilter = `blur(${pxValue}px) brightness(${brightness ? 0.01 * brightness : 85})`;
  }

  // Save on release
  async function handleSave(pxValue: number) {
    setSaving(true);
    try {
      const currentAppearance = user?.appearancePreferences || config?.appearance || {};
      const updatedAppearance = {
        ...currentAppearance,
        wallpaperFilters: {
          ...(currentAppearance.wallpaperFilters ?? {}),
          blur: pxValue,
        },
      };

      await updateUserProperty("appearancePreferences", updatedAppearance);
      refreshConfig();
    } catch (err) {
      console.error("Error updating blur:", err);
    } finally {
      setSaving(false);
    }
  }

  const blurPx = ((percent / 100) * (25 - 1) + 1).toFixed(1);

  return (
    <div
      className={
        className ??
        "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent"
      }
    >
      {/* Label + tooltip */}
      <div className="flex items-center gap-1 min-w-[180px]">
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
            const newValue = Math.round((v / 100) * (25 - 1) + 1);
            handlePreview(newValue);
          }}

          onValueCommit={([v]) => {
            const newValue = Math.round((v / 100) * (25 - 1) + 1);
            handleSave(newValue);
          }}
          className="flex-1"
        />
        {/* Percentage + px */}
        <span className="min-w-[50px] text-right text-medium">
          {blurPx}px
        </span>
      </div>
    </div>
  );
}
