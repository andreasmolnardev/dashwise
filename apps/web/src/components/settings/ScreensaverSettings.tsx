"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { loadFont } from "@/lib/loadFont";
import SmartFramesManager from "./SmartFramesManager.tsx";

export default function ScreensaverSettings() {
  const { user, updateUserProperty } = useAuth();
  const [screensaverConfig, setScreensaverConfig] = useState<any>(
    user?.screensaverPreferences || {},
  );
  const frames = Array.isArray(screensaverConfig?.frames)
    ? screensaverConfig.frames
    : [];
  const [fonts, setFonts] = useState<Array<{ name: string; path: string }>>([]);

  useEffect(() => {
    fetch("/fonts/index.json")
      .then((response) => response.json())
      .then((data) => setFonts(Array.isArray(data) ? data : []))
      .catch((error) => console.error("Failed to load fonts", error));
  }, []);

  useEffect(() => {
    if (!fonts.length) return;

    fonts.forEach((font) => {
      if (font.name && font.path) {
        loadFont(font.name, font.path);
      }
    });
  }, [fonts]);

  useEffect(() => {
    setScreensaverConfig(user?.screensaverPreferences || {});
  }, [user?.screensaverPreferences]);

  const updateScreensaverConfig = async (newPart: any) => {
    const updatedScreensaver = { ...screensaverConfig, ...newPart };
    setScreensaverConfig(updatedScreensaver);

    await updateUserProperty("screensaverPreferences", updatedScreensaver);
  };

  const updateRules = async (
    scope: "global" | "device",
    rules: Record<string, any>,
  ) => {
    const displayRuleKeys = new Set(["inactivityPageId", "manualPageId"]);
    const displayRules = Object.fromEntries(
      Object.entries(rules).filter(([key]) => displayRuleKeys.has(key)),
    );
    const topLevelRules = Object.fromEntries(
      Object.entries(rules).filter(([key]) => !displayRuleKeys.has(key)),
    );

    if (scope === "global") {
      await updateScreensaverConfig({
        ...topLevelRules,
        displayRules: {
          ...(screensaverConfig.displayRules ?? {}),
          ...displayRules,
        },
      });
      return;
    }

    localStorage.setItem(
      "dashwise_screensaver_device_rules",
      JSON.stringify({ ...topLevelRules, displayRules }),
    );
    window.dispatchEvent(new Event("dashwise_local_config_updated"));
  };

  return (
    <>
      <div className="flex flex-col gap-2 mb-4">
        <h1 className="text-3xl font-semibold">Frame</h1>
      </div>
      <div className="content space-y-6">
        <SmartFramesManager
          frames={frames}
          onChange={(newFrames: any[]) =>
            updateScreensaverConfig({ frames: newFrames })}
          onRulesChange={updateRules}
        />
      </div>
    </>
  );
}
