"use client";

import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleHalfStroke, faEyeDropper, faPaintBrush } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/settings/ColorPicker";
import { useConfig } from "@/context/ConfigContext";
import { writeToConfig } from "@/lib/frontend/data/MUTATE/config/writeToConfig";

type ThemeMode = "system" | "dark" | "light";

// Type for the appearance config
type AppearanceConfig = {
  accentColor?: string;
  themeMode?: ThemeMode;
  frostedAppearance?: ThemeMode;
  [key: string]: string | undefined;
};

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

export default function AccentColorSelectComponent({ className }: { className?: string }) {
  const { config, refreshConfig } = useConfig();
  const [accent, setAccent] = useState<string | undefined>(
    config?.appearance?.accentColor
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    config?.appearance?.themeMode ?? config?.appearance?.frostedAppearance ?? "system"
  );

  useEffect(() => {
    setAccent(config?.appearance?.accentColor ?? "#6b21a8");
  }, [config?.appearance?.accentColor]);

  useEffect(() => {
    const nextMode = config?.appearance?.themeMode ?? config?.appearance?.frostedAppearance ?? "system";
    setThemeMode(nextMode);
    applyThemeClasses(nextMode, config?.appearance?.frostedAppearance ?? nextMode);
  }, [config?.appearance?.themeMode, config?.appearance?.frostedAppearance]);

  const PRESET_COLORS = [
    "#0066FF",
    "#00B894",
    "#FF6B6B",
    "#F59E0B",
    "#8B5CF6",
    "#06B6D4",
  ];

  const isCustomAccent = !PRESET_COLORS.some(
    (c) => c.toLowerCase() === (accent ?? "").toLowerCase()
  );

  async function updateAccentColor(newColor: string) {
    const color_hex = newColor.startsWith("#") ? newColor : `#${newColor}`;

    // update local state
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
      const appearanceConfig: AppearanceConfig = { ...(config?.appearance || {}), accentColor: color_hex };
      await writeToConfig("appearance", appearanceConfig);
      await refreshConfig();
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error("Failed to update accent color:", err.message);
      } else {
        console.error("Failed to update accent color (unknown error):", err);
      }
    }
  }

  async function updateThemeMode(newMode: ThemeMode) {
    setThemeMode(newMode);
    applyThemeClasses(newMode, newMode);

    try {
      const appearanceConfig: AppearanceConfig = {
        ...(config?.appearance || {}),
        themeMode: newMode,
        frostedAppearance: newMode,
      };
      await writeToConfig("appearance", appearanceConfig);
      await refreshConfig();
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error("Failed to update theme mode:", err.message);
      } else {
        console.error("Failed to update theme mode (unknown error):", err);
      }
    }
  }

  return (
    <div className={className ?? "border border-transparent col-span-full p-1.5 rounded-md space-y-2"}>
      <div className="flex items-center gap-2">
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

          <span className="w-2 h-2 mx-2 rounded-full frosted"></span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={`frosted rounded-full w-8 h-8 outline-none shadow-none hover:ring-2 hover:ring-gray-300 hover:text-gray-300
      transition-all duration-150 ${isCustomAccent ? "ring-2" : ""}`}
                style={{ background: accent }}
              >
                <FontAwesomeIcon icon={faEyeDropper} fontSize={10} />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className="p-3 w-[320px] frosted text-foreground"
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

      <div className="flex items-center gap-2">
        <FontAwesomeIcon icon={faCircleHalfStroke} />
        <p className="w-full">Theme</p>
        <RadioGroup
          value={themeMode}
          onValueChange={(v) => updateThemeMode(v as ThemeMode)}
          className="flex items-center gap-2"
        >
          <div>
            <RadioGroupItem id="theme-system" value="system" className="peer sr-only" />
            <Label
              htmlFor="theme-system"
              className="cursor-pointer rounded-md px-3 py-1.5 frosted peer-data-[state=checked]:outline peer-data-[state=checked]:outline-(--primary)"
            >
              System
            </Label>
          </div>
          <div>
            <RadioGroupItem id="theme-dark" value="dark" className="peer sr-only" />
            <Label
              htmlFor="theme-dark"
              className="cursor-pointer rounded-md px-3 py-1.5 frosted peer-data-[state=checked]:outline peer-data-[state=checked]:outline-(--primary)"
            >
              Dark
            </Label>
          </div>
          <div>
            <RadioGroupItem id="theme-light" value="light" className="peer sr-only" />
            <Label
              htmlFor="theme-light"
              className="cursor-pointer rounded-md px-3 py-1.5 frosted peer-data-[state=checked]:outline peer-data-[state=checked]:outline-(--primary)"
            >
              Light
            </Label>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
}
