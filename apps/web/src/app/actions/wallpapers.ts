import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
  });
}

export async function uploadWallpaperAction(auth: ActionAuth, formData: FormData) {
  const image = formData.get("image") as File | null;
  const fileName = String(formData.get("fileName") ?? image?.name ?? "wallpaper");
  const convertToWebp = String(formData.get("convertToWebp") ?? "false") === "true";

  if (!image) {
    throw new Error("Missing image file");
  }

  return callApiAction("wallpapers", "uploadWallpaperAction", {
    auth,
    fileName,
    mimeType: image.type || undefined,
    contentBase64: await fileToBase64(image),
    convertToWebp,
  });
}
