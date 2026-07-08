"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { loadFont } from "@/lib/loadFont";
import SmartFramesManager from "./SmartFramesManager.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink } from "lucide-react";

export default function ScreensaverSettings() {
  const { user, updateUserProperty } = useAuth();
  const [screensaverConfig, setScreensaverConfig] = useState<any>(
    user?.screensaverPreferences || {},
  );
  const frames = Array.isArray(screensaverConfig?.frames)
    ? screensaverConfig.frames
    : [];
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesScope, setRulesScope] = useState<"global" | "device">("global");
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

  const getRules = () => {
    if (rulesScope === "global") return screensaverConfig.displayRules || {};
    try {
      return JSON.parse(
        localStorage.getItem("dashwise_screensaver_device_rules") || "{}",
      ) || {};
    } catch {
      return {};
    }
  };
  const updateRules = (patch: any) => {
    if (rulesScope === "global") {
      updateScreensaverConfig({
        displayRules: { ...(screensaverConfig.displayRules || {}), ...patch },
      });
      return;
    }
    const nextRules = { ...(getRules() || {}), ...patch };
    localStorage.setItem(
      "dashwise_screensaver_device_rules",
      JSON.stringify(nextRules),
    );
    window.dispatchEvent(new Event("dashwise_local_config_updated"));
  };

  return (
    <>
      <div className="flex flex-col gap-2 mb-4">
        <h1 className="text-3xl font-semibold">Frame</h1>
      </div>
      <div className="content space-y-6">
        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          className="w-full flex items-center justify-between gap-2 rounded-md border border-transparent text-left transition hover:bg-white/5"
        >
          <h2 className="text-lg font-medium w-full">
            Configure Frame Display (trigger) rules
          </h2>
          <ExternalLink className="h-4 w-4 text-white/80" />
        </button>

        <SmartFramesManager
          frames={frames}
          onChange={(newFrames: any[]) =>
            updateScreensaverConfig({ frames: newFrames })}
        />
      </div>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="frosted max-h-[85vh] max-w-2xl overflow-y-auto text-foreground">
          <DialogHeader>
            <DialogTitle>Frame Display Rules</DialogTitle>
          </DialogHeader>
          <Tabs
            value={rulesScope}
            onValueChange={(value) =>
              setRulesScope(value as "global" | "device")}
            className="space-y-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="global">Global</TabsTrigger>
              <TabsTrigger value="device">This device</TabsTrigger>
            </TabsList>
            <TabsContent value="global" className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="global-manual">Manual trigger button</Label>
                <Switch
                  id="global-manual"
                  checked={!!screensaverConfig.showButton}
                  onCheckedChange={(checked) =>
                    updateScreensaverConfig({ showButton: checked })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <Label htmlFor="global-inactivity">
                  Inactivity period (seconds)
                </Label>
                <Input
                  id="global-inactivity"
                  type="number"
                  min={0}
                  className="w-full sm:w-32 frosted"
                  value={screensaverConfig.inactivityTimeout ?? ""}
                  onChange={(e) =>
                    setScreensaverConfig({
                      ...screensaverConfig,
                      inactivityTimeout: parseInt(e.target.value, 10),
                    })}
                  onBlur={() =>
                    updateScreensaverConfig({
                      inactivityTimeout: screensaverConfig.inactivityTimeout,
                    })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>After inactivity go to</Label>
                  <Select
                    value={screensaverConfig.displayRules?.inactivityPageId ??
                      "frame"}
                    onValueChange={(value) =>
                      updateRules({ inactivityPageId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frame">Frame</SelectItem>
                      {frames.map((frame: any, index: number) => (
                        <SelectItem key={frame.id} value={frame.id}>
                          {frame.params?.name || `Page ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Manual trigger go to</Label>
                  <Select
                    value={screensaverConfig.displayRules?.manualPageId ??
                      "frame"}
                    onValueChange={(value) =>
                      updateRules({ manualPageId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frame">Frame</SelectItem>
                      {frames.map((frame: any, index: number) => (
                        <SelectItem key={frame.id} value={frame.id}>
                          {frame.params?.name || `Page ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="device" className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="device-manual">Manual trigger button</Label>
                <Switch
                  id="device-manual"
                  checked={!!getRules().showButton}
                  onCheckedChange={(checked) =>
                    updateRules({ showButton: checked })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <Label htmlFor="device-inactivity">
                  Inactivity period (seconds)
                </Label>
                <Input
                  id="device-inactivity"
                  type="number"
                  min={0}
                  className="w-full sm:w-32 frosted"
                  value={getRules().inactivityTimeout ?? ""}
                  onChange={(e) =>
                    updateRules({
                      inactivityTimeout: parseInt(e.target.value, 10),
                    })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>After inactivity go to</Label>
                  <Select
                    value={getRules().inactivityPageId ?? "frame"}
                    onValueChange={(value) =>
                      updateRules({ inactivityPageId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frame">Frame</SelectItem>
                      {frames.map((frame: any, index: number) => (
                        <SelectItem key={frame.id} value={frame.id}>
                          {frame.params?.name || `Page ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Manual trigger go to</Label>
                  <Select
                    value={getRules().manualPageId ?? "frame"}
                    onValueChange={(value) =>
                      updateRules({ manualPageId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frame">Frame</SelectItem>
                      {frames.map((frame: any, index: number) => (
                        <SelectItem key={frame.id} value={frame.id}>
                          {frame.params?.name || `Page ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
