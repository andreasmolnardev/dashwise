import type { Hono } from "hono";

import { uploadWallpaper } from "@dashwise/sdk/data/wallpapers";

export function registerWallpapersControllers(app: Hono) {
  app.post("/api/v1/wallpapers", async (c) => {
    const formData = await c.req.formData();
    const image = formData.get("image") as File | null;
    if (!image) {
      return c.json({ error: "Missing image file" }, 400);
    }

    const token = String(formData.get("token") ?? c.req.query("token") ?? "");

    return c.json(await uploadWallpaper(token, formData));
  });
}