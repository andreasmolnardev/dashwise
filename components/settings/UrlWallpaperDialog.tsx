"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfig } from "@/context/ConfigContext";
import { writeToConfig } from "@/lib/frontend/data/write";

interface UrlWallpaperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configKey?: string;
}

interface AppearanceConfig {
  backgroundImageUrl?: string;
  accentColor?: string;
}

export default function UrlWallpaperDialogComponent({
  open,
  onOpenChange,
  configKey = "settings/appearance",
}: UrlWallpaperDialogProps) {
  const { config, refreshConfig } = useConfig();
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);


  async function handleSave() {
    if (!url) {
      setMessage("Please enter a valid image URL.");
      return;
    }

    setSaving(true);
    setMessage(null);

    const token = localStorage.getItem("pb_token");

    try {
      const cfgRoot: Record<string, AppearanceConfig> = config ?? {};
      const currentAppearance = cfgRoot[configKey] ?? {};
      const updatedAppearance: AppearanceConfig = {
        ...currentAppearance,
        backgroundImageUrl: url,
      };

      await writeToConfig(`appearance`, updatedAppearance, { token });

      setMessage("Wallpaper updated.");

      // refresh config
      try {
        await refreshConfig();
      } catch {}

      setSaving(false);
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      setMessage(message || "Unknown error");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-(--text-primary)">
        <DialogHeader>
          <DialogTitle>Set wallpaper from URL</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="wallpaper-url">Image URL</Label>
            <Input
              id="wallpaper-url"
              type="url"
              placeholder="https://example.com/wallpaper.jpg"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            />
          </div>

          {url && (
            <div className="rounded-md overflow-hidden relative w-full flex justify-center">
              <img
                src={url}
                alt="preview"
                style={{ objectFit: "contain" }}
                className="h-52 rounded-md"
              />
            </div>
          )}

          {message && <div className="text-sm text-muted-foreground">{message}</div>}
        </div>

        <DialogFooter>
          <Button
            disabled={saving}
            onClick={() => onOpenChange(false)}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
