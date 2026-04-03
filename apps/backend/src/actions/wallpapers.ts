
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { uploadWallpaper } from "@dashwise/sdk/data/wallpapers";

export async function uploadWallpaperAction(auth: ActionAuth, formData: FormData) {
  await requireUserAuth(auth);
  return uploadWallpaper(String(auth.token), formData);
}
