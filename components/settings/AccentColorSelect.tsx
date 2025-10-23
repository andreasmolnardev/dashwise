"use client";

import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEyeDropper, faPaintBrush } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { ColorPicker } from "@/components/settings/ColorPicker";
import { useConfig } from "@/context/ConfigContext";

// Type for the appearance config
type AppearanceConfig = {
  accentColor?: string;
  [key: string]: string | undefined; // other fields if any
};

export default function AccentColorSelectComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = useConfig();
  const [accent, setAccent] = useState<string | undefined>(
    config?.appearance?.accentColor
  );

  useEffect(() => {
    setAccent(config?.appearance?.accentColor ?? "#6b21a8");
  }, [config?.appearance?.accentColor]);

  const PRESET_COLORS = [
    "#0066FF",
    "#00B894",
    "#FF6B6B",
    "#F59E0B",
    "#8B5CF6",
    "#06B6D4",
  ];

  async function updateAccentColor(newColor: string) {
    const color_hex = newColor.startsWith("#") ? newColor : `#${newColor}`;

    setAccent(color_hex);

    // update local CSS var for immediate feedback
    try {
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--primary", color_hex);
      }
    } catch {
      // ignore
    }

    // persist to server
    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");

      const appearanceConfig: AppearanceConfig = { ...(config?.appearance || {}) };
      appearanceConfig.accentColor = color_hex;

      const payload = { updatedItem: appearanceConfig };

      const res = await fetch("/api/v1/config?path=appearance", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      let json: Record<string, unknown> = {};
      try {
        json = await res.json();
      } catch {
        // non-json response is ok
      }

      if (!res.ok) {
        console.error("Failed to update accent color", json);
        return;
      }

    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error("updateAccentColor error:", err.message);
      } else {
        console.error("updateAccentColor unknown error:", err);
      }
    }
  }

  return (
    <div
      className={
        className ??
        "flex border border-transparent items-center col-span-full p-1.5 rounded-md gap-2"
      }
    >
      <FontAwesomeIcon icon={faPaintBrush} />
      <p className="w-full">Accent Color</p>

      <div className="flex items-center gap-2">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            title={c}
            aria-label={`Choose ${c}`}
            onClick={() => updateAccentColor(c)}
            className={`w-7 h-7 rounded-full border-2 transform transition-transform duration-150 active:scale-90 ${accent?.toLowerCase() === c.toLowerCase() ? "ring-1 ring-offset-1" : ""
              }`}
            style={{ background: c, borderColor: "rgba(255,255,255,0.08)" }}
          />
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-2 p-2 frosted rounded-full" style={{ background: accent }}>
              <FontAwesomeIcon icon={faEyeDropper} fontSize={10} />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="p-3 w-[320px] frosted text-(--text-primary)"
          >
            <div className="w-72">
              <ColorPicker
                value={accent ?? "#6b21a8"}
                onValueChange={(v) => updateAccentColor(v)}
                className="space-y-2"
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
