import sharp from "sharp";
import { getServerPB } from "@/lib/pb";

const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;

export async function uploadWallpaper(userToken: string, formData: FormData) {
  const pb = getServerPB();
  pb.authStore.save(userToken, null);

  const authModel = await pb.collection("users").authRefresh();
  const userId = authModel.record.id;

  const incomingFile = formData.get("image") as File | null;
  const convertToWebpField = formData.get("convertToWebp");
  const convertToWebp = convertToWebpField === "true" || convertToWebpField === "1";
  const fileNameField = (formData.get("fileName") as string) || incomingFile?.name;

  if (!incomingFile || !fileNameField) {
    throw new Error("Missing form fields: image and fileName are required");
  }

  const originalFileName = incomingFile.name || fileNameField;
  const baseName = originalFileName.replace(/\.[^.]+$/, "") || "wallpaper";
  const targetFileName = convertToWebp ? `${baseName}.webp` : originalFileName;

  const arrayBuffer = await incomingFile.arrayBuffer();
  let buffer: Buffer = Buffer.from(arrayBuffer);

  const meta = await sharp(buffer).metadata();
  if ((meta.width && meta.width > MAX_WIDTH) || (meta.height && meta.height > MAX_HEIGHT)) {
    buffer = await sharp(buffer)
      .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside" })
      .toBuffer();
  }

  if (convertToWebp) {
    buffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
  }

  const uploadForm = new FormData();
  uploadForm.append("fileName", targetFileName);
  uploadForm.append("image", new Blob([new Uint8Array(buffer)]), targetFileName);
  uploadForm.append("userId", userId);

  const existing = await pb.collection("wallpaperStore").getList(1, 1, {
    filter: `userId="${userId}"`,
  });

  const oldWallpaper = existing.items?.[0] ?? null;
  await pb.collection("wallpaperStore").create(uploadForm);

  if (oldWallpaper) {
    await pb.collection("wallpaperStore").delete(oldWallpaper.id);
  }

  return {
    success: true,
    path: `/api/v1/wallpapers?fileName=${encodeURIComponent(targetFileName)}`,
  };
}

export async function getWallpaperByFileName(userToken: string, fileName: string) {
  const pb = getServerPB();
  pb.authStore.save(userToken, null);

  let record;
  try {
    record = await pb.collection("wallpaperStore").getFirstListItem(`fileName="${fileName}"`);
  } catch {
    return null;
  }

  const fileUrl = pb.files.getURL(record, (record as any).image);
  const fileResponse = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${userToken}` },
  });

  if (!fileResponse.ok) {
    throw new Error("Failed to retrieve wallpaper file");
  }

  const contentType = fileResponse.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await fileResponse.arrayBuffer();

  return {
    contentType,
    buffer: Buffer.from(arrayBuffer),
  };
}
