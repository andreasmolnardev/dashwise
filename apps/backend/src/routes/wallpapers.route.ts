import { Hono } from "hono";

import { uploadWallpaper, getWallpaperByFileName } from "../lib/data/wallpapers";

const wallpapersRoute = new Hono()
  wallpapersRoute.get("/api/v1/wallpapers", async (c) => {
    const fileName = c.req.query("fileName");
    const token = c.req.header("Authorization")?.replace("Bearer ", "") || c.req.query("token") || "";

    if (!fileName) {
      return c.json({ error: "Missing fileName query parameter" }, 400);
    }

    try {
      const result = await getWallpaperByFileName(token, fileName);
      if (!result) {
        return c.json({ error: "Wallpaper not found" }, 404);
      }

      return new Response(result.buffer, {
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      console.error("Error fetching wallpaper:", error);
      return c.json({ error: "Failed to fetch wallpaper" }, 500);
    }
  });

  wallpapersRoute.post("/api/v1/wallpapers", async (c) => {
    let formData = new FormData();
    const contentType = c.req.header("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const body = await c.req.json();
        const base64Content = body.contentBase64;
        if (!base64Content) {
          return c.json({ error: "Missing contentBase64 in JSON body" }, 400);
        }
        
        // Convert base64 to Blob
        const buffer = Buffer.from(base64Content, "base64");
        const blob = new Blob([buffer], { type: body.mimeType || "image/png" });
        formData.append("image", blob, body.fileName || "wallpaper.png");
        formData.append("fileName", body.fileName || "wallpaper.png");
        if (body.convertToWebp !== undefined) {
          formData.append("convertToWebp", String(body.convertToWebp));
        }
        if (body.auth?.token) {
          formData.append("token", body.auth.token);
        }
      } catch (error) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
    } else {
      try {
        formData = await c.req.formData();
      } catch (error) {
        return c.json({ error: "Invalid form data or incorrect content-type" }, 400);
      }
    }

    const image = formData.get("image") as File | null;
    if (!image) {
      return c.json({ error: "Missing image file" }, 400);
    }

    const token = String(formData.get("token") ?? c.req.query("token") ?? "");

    return c.json(await uploadWallpaper(token, formData));
  });


export default wallpapersRoute;
