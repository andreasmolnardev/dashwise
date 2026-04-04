"use client";

import { useEffect, useState } from "react";
import { loadFont } from "@/lib/loadFont";
import ClockWidget from "../widgets/ClockWidget";
import useAuth from "@/context/useAuth";

export default function Screensaver({ active, onExit }: { active: boolean; onExit: () => void }) {
  const { user } = useAuth();
  const [fonts, setFonts] = useState<{ name: string; path: string }[]>([]);
  const [screensaverConfig, setScreensaverConfig] = useState<any>(user?.screensaverPreferences);

  useEffect(() => {
    fetch("/fonts/index.json")
      .then((res) => res.json())
      .then(setFonts);
    
    const checkLocal = () => {
      const local = localStorage.getItem("dashwise_screensaver_local");
      if (local) {
        setScreensaverConfig(JSON.parse(local));
      } else {
        setScreensaverConfig(user?.screensaverPreferences);
      }
    };

    checkLocal();
    window.addEventListener("dashwise_local_config_updated", checkLocal);
    return () => window.removeEventListener("dashwise_local_config_updated", checkLocal);
  }, [user?.screensaverPreferences]);

  const useHomePageStyle = screensaverConfig?.useHomePageStyle ?? true;
  const homePageFont = user?.appearancePreferences?.clock?.defaultFont || "MomoTrustDisplay";

  const clockFont = useHomePageStyle ? homePageFont : screensaverConfig?.clockFont || homePageFont;
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
      className="fixed inset-0 bg-black backdrop-blur-xl z-100 flex items-center justify-center"
      onClick={onExit}
    >
      <ClockWidget 
        font={clockFont}
        weight={clockFontWeight.startsWith('font-') ? clockFontWeight.split('-')[1] : clockFontWeight}
        color={color}
        style={{ fontSize: `${size}rem` }}
        className="p-0"
      />
    </div>
  );
}
