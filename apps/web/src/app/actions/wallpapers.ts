import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { uploadWallpaperViaBackend } from "@/src/lib/action-client";

export async function uploadWallpaperAction(auth: ActionAuth, formData: FormData) {
  return uploadWallpaperViaBackend(auth?.token ?? null, formData);
}
