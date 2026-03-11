// TODO: migrate to screensaver preferences
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePageConfig } from "@/hooks/usePageConfig";
import { useState, useEffect } from "react";
import fonts from "@/public/fonts/index.json";
import useAuth from "@/context/useAuth";
import ClockWidget from "../widgets/ClockWidget";
import { loadFont } from "@/lib/loadFont";

const fontWeights = [
  { name: "Light", value: "font-light" },
  { name: "Normal", value: "font-normal" },
  { name: "Semibold", value: "font-semibold" },
  { name: "Bold", value: "font-bold" },
];

export default function ScreensaverSettings() {
  const { config, patchConfig } = usePageConfig();
  const { user, updateUserProperty } = useAuth();
  const [scope, setScope] = useState<"global" | "local">("global");
  const [screensaverConfig, setScreensaverConfig] = useState(
    user?.appearancePreferences?.screensaver || config.appearance.screensaver || {}
  );
  const [useHomePageStyle, setUseHomePageStyle] = useState(
    screensaverConfig.useHomePageStyle ?? true
  );

  useEffect(() => {
    const local = localStorage.getItem("dashwise_screensaver_local");
    if (local) {
      setScope("local");
      const parsed = JSON.parse(local);
      setScreensaverConfig(parsed);
      setUseHomePageStyle(parsed.useHomePageStyle ?? true);
    } else {
      setScope("global");
      const globalScreensaver = user?.appearancePreferences?.screensaver || config.appearance.screensaver || {};
      setScreensaverConfig(globalScreensaver);
      setUseHomePageStyle(globalScreensaver?.useHomePageStyle ?? true);
    }
  }, [user?.appearancePreferences?.screensaver, config.appearance.screensaver]);

  const updateScreensaverConfig = async (newPart: any) => {
    const updatedScreensaver = { ...screensaverConfig, ...newPart };
    setScreensaverConfig(updatedScreensaver);

    if (scope === "local") {
      localStorage.setItem("dashwise_screensaver_local", JSON.stringify(updatedScreensaver));
      // Dispatch event for components to react to local change
      window.dispatchEvent(new Event("dashwise_local_config_updated"));
    } else {
      const currentAppearance = user?.appearancePreferences || config.appearance || {};
      const updatedAppearance = {
        ...currentAppearance,
        screensaver: updatedScreensaver
      };

      patchConfig((prev) => ({
        ...prev,
        appearance: updatedAppearance,
      }));

      await updateUserProperty("appearancePreferences", updatedAppearance);
    }
  };

  const handleScopeChange = (newScope: "global" | "local") => {
    setScope(newScope);
    if (newScope === "global") {
      localStorage.removeItem("dashwise_screensaver_local");
      const globalScreensaver = user?.appearancePreferences?.screensaver || config.appearance.screensaver || {};
      setScreensaverConfig(globalScreensaver);
      setUseHomePageStyle(globalScreensaver?.useHomePageStyle ?? true);
      window.dispatchEvent(new Event("dashwise_local_config_updated"));
    } else {
      // Initialize local with current global
      const initialLocal = { ...screensaverConfig };
      localStorage.setItem("dashwise_screensaver_local", JSON.stringify(initialLocal));
    }
  };

  const homePageFont = config.appearance?.clock?.defaultFont || "MomoTrustDisplay";
  const previewFont = useHomePageStyle ? homePageFont : screensaverConfig.clockFont || homePageFont;
  const previewWeight = useHomePageStyle ? "font-normal" : screensaverConfig.clockFontWeight || "font-normal";
  const previewColor = useHomePageStyle ? "rgba(255, 255, 255, 0.8)" : screensaverConfig.color || "rgba(255, 255, 255, 0.8)";
  const previewSize = useHomePageStyle ? 5 : screensaverConfig.size || 9; // default screen size is large

  useEffect(() => {
    if (previewFont) {
      const fontDetails = fonts.find(f => f.name === previewFont);
      if (fontDetails) {
        loadFont(previewFont, fontDetails.path);
      }
    }
  }, [previewFont]);

  return (
    <>
      <div className="flex flex-col gap-2 mb-4">
        <h1 className="text-3xl font-semibold">Screensaver</h1>
        <div className="flex bg-white/5 p-1 border border-white/10 w-fit rounded-full gap-2">
          <button
            onClick={() => handleScopeChange("global")}
            className={`px-3 py-1 text-sm rounded-full transition-all ${scope === "global" ? "frosted shadow-sm" : "hover:bg-white/5 border-transparent"}`}
          >
            Global
          </button>
          <button
            onClick={() => handleScopeChange("local")}
            className={`px-3 py-1 text-sm rounded-full  transition-all ${scope === "local" ? "frosted shadow-sm" : "hover:bg-white/5 border-transparent"}`}
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
              <Label htmlFor="show-button">Show screensaver button</Label>
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
          <h2 className="text-xl font-semibold">Appearance</h2>
          <div className="space-y-4 px-2">
            <div className="w-full h-48 rounded-xl flex items-center justify-center relative overflow-hidden border frosted">
              <ClockWidget
                font={previewFont}
                weight={previewWeight.startsWith('font-') ? previewWeight.split('-')[1] : previewWeight}
                color={previewColor}
                style={{ fontSize: `${previewSize}rem` }}
                className="p-0"
              />
            </div>

            <RadioGroup
              value={useHomePageStyle ? "default" : "custom"}
              onValueChange={(val) => {
                const isHome = val === "default";
                setUseHomePageStyle(isHome);
                updateScreensaverConfig({ useHomePageStyle: isHome });
              }}
              className="flex gap-2 pt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="default" id="default" className="frosted"/>
                <Label htmlFor="default">Use home page style</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="custom" className="frosted"/>
                <Label htmlFor="custom">Custom</Label>
              </div>
            </RadioGroup>

            {!useHomePageStyle && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Clock Font</Label>
                  <Select
                    value={screensaverConfig.clockFont}
                    onValueChange={(val) => updateScreensaverConfig({ clockFont: val })}
                  >
                    <SelectTrigger className="w-[180px] frosted">
                      <SelectValue placeholder="Select a font" />
                    </SelectTrigger>
                    <SelectContent>
                      {fonts.map((font) => (
                        <SelectItem key={font.name} value={font.name}>
                          {font.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label>Font Weight</Label>
                  <Select
                    value={screensaverConfig.clockFontWeight}
                    onValueChange={(val) => updateScreensaverConfig({ clockFontWeight: val })}
                  >
                    <SelectTrigger className="w-[180px] frosted">
                      <SelectValue placeholder="Select weight" />
                    </SelectTrigger>
                    <SelectContent>
                      {fontWeights.map((w) => (
                        <SelectItem key={w.value} value={w.value}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label>Color (with opacity)</Label>
                  <Input
                    type="text"
                    className="w-[180px] frosted"
                    placeholder="rgba(255,255,255,0.8)"
                    value={screensaverConfig.color || ""}
                    onChange={(e) => setScreensaverConfig({ ...screensaverConfig, color: e.target.value })}
                    onBlur={(e) => updateScreensaverConfig({ color: e.target.value })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label>Clock Size (rem)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    className="w-[180px] frosted"
                    value={screensaverConfig.size || ""}
                    onChange={(e) => setScreensaverConfig({ ...screensaverConfig, size: parseFloat(e.target.value) })}
                    onBlur={(e) => updateScreensaverConfig({ size: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
