"use client";

import { useConfig } from "@/context/ConfigContext";
import { useEffect, useState } from "react";
import { loadFont } from "@/lib/loadFont";
import ClockWidget from "../widgets/ClockWidget";

export default function Screensaver({ active, onExit }: { active: boolean; onExit: () => void }) {
  const { config } = useConfig();
  const [fonts, setFonts] = useState<{ name: string; path: string }[]>([]);
  const screensaverConfig = config.appearance?.screensaver;

  useEffect(() => {
    fetch("/fonts/index.json")
      .then((res) => res.json())
      .then(setFonts);
  }, []);

  const useHomePageStyle = screensaverConfig?.useHomePageStyle ?? true;
  const homePageFont = config.appearance?.clock?.defaultFont ||  "MomoTrustDisplay";

  const clockFont = useHomePageStyle ? homePageFont : screensaverConfig?.clockFont || homePageFont;
    console.log("clock font", clockFont)
  const clockFontWeight = useHomePageStyle ? "font-normal" : screensaverConfig?.clockFontWeight || "font-normal";
  const color = useHomePageStyle ? "rgba(255, 255, 255, 0.8)" : screensaverConfig?.color || "rgba(255, 255, 255, 0.8)";
  const size = useHomePageStyle ? 5 : screensaverConfig?.size || 9;

  useEffect(() => {
    if (clockFont) {
      const fontDetails = fonts.find(f => f.name === clockFont);
      if (fontDetails) {
        loadFont(clockFont, fontDetails.path);
      }
    }
  }, [clockFont, fonts]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 bg-black backdrop-blur-xl z-[100] flex items-center justify-center"
      onClick={onExit}
    >
      <ClockWidget 
        format={(config?.global?.["time-format"] as "12h" | "24h") || "24h"} 
        font={clockFont}
        weight={clockFontWeight.startsWith('font-') ? clockFontWeight.split('-')[1] : clockFontWeight}
        color={color}
        style={{ fontSize: `${size}rem` }}
        className="p-0"
      />
    </div>
  );
}
