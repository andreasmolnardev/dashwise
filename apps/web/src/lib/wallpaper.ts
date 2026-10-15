/** Migrate the bundled PNG fallback while preserving custom wallpaper URLs. */
export function resolveWallpaperSource(source: string | null | undefined, defaultSource: string) {
  if (!source || source === defaultSource || source === "/dashboard-wallpaper.png" || source === "/assets/dashboard-wallpaper.png") {
    return defaultSource;
  }
  return source.startsWith("/assets/") ? source.replace(/^\/assets\//, "/") : source;
}
