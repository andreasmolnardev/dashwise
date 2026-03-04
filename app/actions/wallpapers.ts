"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import { uploadWallpaper } from "@/lib/api/data/wallpapers";

export async function uploadWallpaperAction(auth: ActionAuth, formData: FormData) {
  await requireUserAuth(auth);
  return uploadWallpaper(String(auth.token), formData);
}
