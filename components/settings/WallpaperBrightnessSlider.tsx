"use client";

import React, { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useConfig } from "@/context/ConfigContext";
import { writeToConfig } from "@/lib/frontend/data/MUTATE/config/writeToConfig";

export default function WallpaperBrightnessSliderComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = useConfig();
  const [percent, setPercent] = useState(100); // slider percentage (mapped to 50–150%)
  const [previewBrightness, setPreviewBrightness] = useState(100);
  const [saving, setSaving] = useState(false);

  // Load current brightness from config
  useEffect(() => {
    const current = config?.appearance?.wallpaperFilters?.brightness;
    if (typeof current === "number") {
      const mapped = ((current - 50) / (150 - 50)) * 100;
      setPercent(Math.round(mapped));
      setPreviewBrightness(current);
    }
  }, [config]);

  // Live preview while dragging
  function handlePreview(value: number) {
    setPreviewBrightness(value);
    // Only apply brightness + blur preview without touching config on mount
    const blur = config?.appearance?.wallpaperFilters?.blur ?? 3; // fallback blur
    document.body.style.backdropFilter = `brightness(${value}%) blur(${blur}px)`;
  }

  // Save when released
  async function handleSave(value: number) {
    const token = localStorage.getItem("pb_token");
    if (!token) return;

    setSaving(true);
    try {
      const currentAppearance = config?.appearance ?? {};
      const updatedAppearance = {
        ...currentAppearance,
        wallpaperFilters: {
          ...(currentAppearance.wallpaperFilters ?? {}),
          brightness: value,
        },
      };

      await writeToConfig("appearance", updatedAppearance, {
        token,
        onSuccess: () => refreshConfig(),
      });
    } catch (err) {
      console.error("Error updating brightness:", err);
    } finally {
      setSaving(false);
    }
  }

  const brightnessValue = ((percent / 100) * (150 - 50) + 50).toFixed(0); // 50–150%

  return (
    <div
      className={cn(
        "flex items-center justify-between col-span-full p-2 rounded-md gap-4 bg-(--surface-hover) border border-transparent",
        className
      )}
    >
      {/* Label */}
      <div className="flex items-center gap-1 min-w-[180px]">
        <p className="font-medium text-(--text-primary)">Darken/Brighten</p>
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
            const newValue = Math.round((v / 100) * (150 - 50) + 50);
            handlePreview(newValue);
          }}

          onValueCommit={([v]) => {
            const newValue = Math.round((v / 100) * (150 - 50) + 50);
            handleSave(newValue);
          }}

          className="flex-1"
        />
        {/* Percentage */}
        <span className="min-w-[50px] text-right text-medium">
          {brightnessValue}%
        </span>
      </div>
    </div>
  );
}
