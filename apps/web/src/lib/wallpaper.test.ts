import { expect, test } from "bun:test";
import { resolveWallpaperSource } from "./wallpaper";

const bundled = "/assets/dashboard-wallpaper-Abcd1234.webp";
test("uses the fingerprinted wallpaper for defaults and legacy saved defaults", () => {
  for (const source of [undefined, null, "", "/dashboard-wallpaper.png", "/assets/dashboard-wallpaper.png", bundled]) {
    expect(resolveWallpaperSource(source, bundled)).toBe(bundled);
  }
});
test("preserves configured defaults, custom URLs, and legacy asset normalization", () => {
  expect(resolveWallpaperSource(null, "https://example.com/default.jpg")).toBe("https://example.com/default.jpg");
  expect(resolveWallpaperSource("https://example.com/custom.jpg", bundled)).toBe("https://example.com/custom.jpg");
  expect(resolveWallpaperSource("/api/v1/wallpapers/custom", bundled)).toBe("/api/v1/wallpapers/custom");
  expect(resolveWallpaperSource("/assets/custom.jpg", bundled)).toBe("/custom.jpg");
});
