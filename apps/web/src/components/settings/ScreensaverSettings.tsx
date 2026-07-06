"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import useAuth from "@/context/useAuth";
import { loadFont } from "@/lib/loadFont";
import SmartFramesManager from "./SmartFramesManager.tsx";

export default function ScreensaverSettings() {
  const { user, updateUserProperty } = useAuth();
  const [scope, setScope] = useState<"global" | "local">("global");
  const [screensaverConfig, setScreensaverConfig] = useState<any>(user?.screensaverPreferences || {});
  const frames = Array.isArray(screensaverConfig?.frames) ? screensaverConfig.frames : [];
  const [fonts, setFonts] = useState<Array<{ name: string; path: string }>>([]);
  const [useHomePageStyle, setUseHomePageStyle] = useState(
    screensaverConfig.useHomePageStyle ?? true
  );

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
    setUseHomePageStyle(screensaverConfig.useHomePageStyle ?? true);
  }, [screensaverConfig.useHomePageStyle]);

  useEffect(() => {
    const local = localStorage.getItem("dashwise_screensaver_local");
    if (local) {
      setScope("local");
      setScreensaverConfig(JSON.parse(local));
    } else {
      setScope("global");
      setScreensaverConfig(user?.screensaverPreferences || {});
    }
  }, [user?.screensaverPreferences]);

  const updateScreensaverConfig = async (newPart: any) => {
    const updatedScreensaver = { ...screensaverConfig, ...newPart };
    setScreensaverConfig(updatedScreensaver);
    if (typeof newPart.useHomePageStyle === "boolean") {
      setUseHomePageStyle(newPart.useHomePageStyle);
    }

    if (scope === "local") {
      localStorage.setItem("dashwise_screensaver_local", JSON.stringify(updatedScreensaver));
      window.dispatchEvent(new Event("dashwise_local_config_updated"));
    } else {
      await updateUserProperty("screensaverPreferences", updatedScreensaver);
    }
  };

  const handleScopeChange = (newScope: "global" | "local") => {
    setScope(newScope);
    if (newScope === "global") {
      localStorage.removeItem("dashwise_screensaver_local");
      setScreensaverConfig(user?.screensaverPreferences || {});
      window.dispatchEvent(new Event("dashwise_local_config_updated"));
    } else {
      const initialLocal = { ...screensaverConfig };
      localStorage.setItem("dashwise_screensaver_local", JSON.stringify(initialLocal));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 mb-4">
        <h1 className="text-3xl font-semibold">Frame</h1>
        <div className="flex bg-white/5 p-1 border border-white/10 w-fit rounded-full gap-2">
          <button
            onClick={() => handleScopeChange("global")}
            className={`px-3 py-1 text-sm rounded-full transition-all ${scope === "global" ? "frosted shadow-sm" : "hover:bg-white/5 border-transparent"}`}
          >
            Global
          </button>
          <button
            onClick={() => handleScopeChange("local")}
            className={`px-3 py-1 text-sm rounded-full transition-all ${scope === "local" ? "frosted shadow-sm" : "hover:bg-white/5 border-transparent"}`}
          >
            Local (Device)
          </button>
        </div>
      </div>
      <div className="content space-y-6">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Triggers</h2>
          <div className="space-y-4 px-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="show-button">Show Smart frame button</Label>
              <Switch
                id="show-button"
                checked={screensaverConfig.showButton || false}
                onCheckedChange={(checked) => updateScreensaverConfig({ showButton: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="inactivity-time">
                Inactivity time (seconds)
              </Label>
              <Input
                id="inactivity-time"
                type="number"
                className="w-24 frosted"
                value={screensaverConfig.inactivityTimeout ?? ""}
                onChange={(e) => setScreensaverConfig({ ...screensaverConfig, inactivityTimeout: parseInt(e.target.value, 10) })}
                onBlur={(e) => updateScreensaverConfig({ inactivityTimeout: parseInt(e.target.value, 10) })}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Style</h2>
          <div className="space-y-4 px-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="use-home-page-style">Use home page style</Label>
              <Switch
                id="use-home-page-style"
                checked={useHomePageStyle}
                onCheckedChange={(checked) => updateScreensaverConfig({ useHomePageStyle: checked })}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Frames</h2>
          <SmartFramesManager
            frames={frames}
            onChange={(newFrames: any[]) => updateScreensaverConfig({ frames: newFrames })}
          />
        </section>
      </div>
    </>
  );
}
