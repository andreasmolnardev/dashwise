"use client";

import React, { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/context/ConfigContext";
import useAuth from "@/context/useAuth";
import Image from "next/image";
import { uploadWallpaperAction } from "@/app/actions/wallpapers";
import { updateConfigPathAction } from "@/app/actions/config";

interface UploadWallpaperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UploadWallpaperDialog({
  open,
  onOpenChange,
}: UploadWallpaperDialogProps) {
  const { config, patchConfig } = useConfig();
  const { withAuth } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [convertToWebp, setConvertToWebp] = useState(false);

  // Build a temporary preview URL when the user selects a file
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Reset local state whenever the dialog closes
  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
      setMessage(null);
      setUploading(false);
      setConvertToWebp(false);
    }
  }, [open]);

  const handleUpload = async (): Promise<void> => {
    if (!file) {
      setMessage("Please pick a file first.");
      return;
    }
    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("image", file, file.name);
    formData.append("fileName", file.name);
    formData.append("convertToWebp", convertToWebp ? "true" : "false");
    try {
      // 1) Upload the image
      const body: any = await withAuth((auth) => uploadWallpaperAction(auth, formData));

      const wallpaperPath = body.path as string;

      // 2) Patch the appearance config
      const updatedAppearance = {
        ...(config.appearance ?? {}),
        backgroundImageUrl: wallpaperPath,
      };
      patchConfig((prev) => ({
        ...prev,
        appearance: updatedAppearance,
      }));
      await withAuth((auth) => updateConfigPathAction(auth, "appearance", updatedAppearance));

      setMessage("Upload complete — wallpaper updated.");

      // 3) Close dialog
      onOpenChange(false);
    } catch (err: unknown) {
      console.error(err);
      if (err instanceof Error) {
        setMessage(err.message);
      } else {
        setMessage("Unknown error");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>Upload wallpaper</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-4">
            <Label htmlFor="wallpaper-file">Image file</Label>
            <Input
              id="wallpaper-file"
              type="file"
              accept="image/*"
              onChange={(event) =>
                setFile(event.target.files?.[0] ?? null)
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="convert-to-webp">Convert to WebP</Label>
              <p className="text-xs text-muted-foreground">
                Smaller file size, faster loading times.
              </p>
            </div>
            <Switch
              id="convert-to-webp"
              checked={convertToWebp}
              onCheckedChange={setConvertToWebp}
            />
          </div>

          {preview && (
            <div className="relative w-full h-48 rounded-md overflow-hidden">
              <Image
                src={preview}
                alt="preview"
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          )}

          {message && (
            <div className="text-sm text-muted-foreground">{message}</div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={uploading}
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button 
            disabled={uploading}
            className="cursor-pointer"
            onClick={handleUpload}
          >
            {uploading ? "Uploading…" : "Upload & Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
