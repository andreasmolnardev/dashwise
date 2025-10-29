"use client";

import { useState, useEffect } from "react";
import { PaginatedCarouselViewComponent } from "../widgets/PaginatedCarouselView";
import { useConfig } from "@/context/ConfigContext";
import { loadFont } from "@/lib/loadFont";

type FontEntry = {
  name: string;
  path: string;
};

export default function ClockFontSelectionCarousel() {
  const { config, refreshConfig } = useConfig();

  const DEFAULT_FONT = "Default";

  // list of available fonts (includes a "Default" option with empty path)
  const [fonts, setFonts] = useState<FontEntry[]>([]);

  // selected font name (no localStorage persistence anymore)
  const [selected, setSelected] = useState<string>(() => DEFAULT_FONT);

  // Fetch font list and add "Default" option
  useEffect(() => {
    let mounted = true;
    fetch("/fonts/index.json")
      .then((r) => r.json())
      .then((data: FontEntry[]) => {
        if (!mounted) return;
        const fixed = data.map((f) => ({ name: f.name, path: f.path }));
        setFonts([{ name: "Default", path: "" }, ...fixed]);
      })
      .catch((e) => console.error("Failed to load fonts", e));

    return () => {
      mounted = false;
    };
  }, []);

  // When config loads, adopt server's appearance.clock.defaultFont (or fallback)
  useEffect(() => {
    if (!config) return;
    const cfgFont = config?.appearance?.clock?.defaultFont ?? DEFAULT_FONT;
    setSelected(cfgFont);
  }, [config]);

  // Preload fonts for preview whenever the fonts list is available
  useEffect(() => {
    if (!fonts.length) return;
    fonts.forEach((font) => {
      if (font.path) loadFont(font.name, font.path);
    });
  }, [fonts]);

  // Ensure the currently-selected font is loaded (useful after config sets selected)
  useEffect(() => {
    if (!fonts.length) return;
    const match = fonts.find((f) => f.name === selected);
    if (match && match.path) loadFont(match.name, match.path);
  }, [fonts, selected]);

  const handleSelect = async (font: FontEntry) => {
    // Load font for immediate preview (skip Default)
    if (font.path) loadFont(font.name, font.path);

    // Value we want to set in the server config (null clears it)
    const valueForConfig = font.name === "Default" ? null : font.name;

    // Build updated appearance by shallow-merging existing appearance
    const currentAppearance = (config && config.appearance) ? config.appearance : {};
    const updatedAppearance = {
      ...currentAppearance,
      clock: {
        ...(currentAppearance.clock ?? {}),
        defaultFont: valueForConfig,
      },
    };

    // Read pb_token for auth (still stored client-side per your earlier setup)
    const pbToken = typeof window !== "undefined" ? localStorage.getItem("pb_token") : null;

    // Optimistically update UI so the chosen card highlights immediately
    setSelected(font.name);

    try {
      const res = await fetch("/api/v1/config?path=appearance", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(pbToken ? { Authorization: `Bearer ${pbToken}` } : {}),
        },
        body: JSON.stringify({ updatedItem:updatedAppearance }),
      });

      if (!res.ok) {
        // non-blocking error path: log and optionally revert (we keep optimistic UX)
        console.error("Failed to update config:", await res.text());
      } else {
        // ask the app to refresh its config so other components pick up the change
        try {
          await refreshConfig?.();
        } catch (e) {
          console.warn("refreshConfig failed:", e);
        }
      }
    } catch (e) {
      console.error("Error while calling config PATCH:", e);
    }
  };

  if (!fonts.length) {
    return (
      <div className="text-sm text-muted-foreground">
        No fonts found in <code>/public/fonts/index.json</code>
      </div>
    );
  }

  return (
    <div className="space-y-3 flex items-center justify-center">
      <PaginatedCarouselViewComponent minColWidth={180} rowHeight={120} maxCols={4}>
        {fonts.map((font) => (
          <button
            key={font.name}
            onClick={() => handleSelect(font)}
            className={`rounded-xl p-4 text-center transition-all border-2 ${
              selected === font.name
                ? "border-[var(--primary)] shadow-lg"
                : "border-transparent hover:border-[var(--primary)]/50"
            }`}
          >
            <div
              className="text-4xl font-semibold leading-none"
              style={{
                fontFamily: font.name !== "Default" ? `"${font.name}", system-ui` : undefined,
              }}
            >
              12:45
            </div>
            <div className="text-sm mt-2">{font.name}</div>
          </button>
        ))}
      </PaginatedCarouselViewComponent>
    </div>
  );
}
