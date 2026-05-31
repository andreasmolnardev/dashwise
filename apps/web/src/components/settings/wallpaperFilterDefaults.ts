export const DEFAULT_WALLPAPER_FILTERS = {
  blur: 10,
  brightness: 61,
  darkModeBrightness: 0,
} as const;

const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 150;
const BLUR_MIN = 1;
const BLUR_MAX = 25;

export type WallpaperFilters = {
  blur?: number;
  brightness?: number;
  darkModeBrightness?: number;
};

export function normalizeWallpaperFilters(filters?: WallpaperFilters | null) {
  return {
    blur: typeof filters?.blur === "number" ? filters.blur : DEFAULT_WALLPAPER_FILTERS.blur,
    brightness:
      typeof filters?.brightness === "number"
        ? filters.brightness
        : DEFAULT_WALLPAPER_FILTERS.brightness,
    darkModeBrightness:
      typeof filters?.darkModeBrightness === "number"
        ? filters.darkModeBrightness
        : DEFAULT_WALLPAPER_FILTERS.darkModeBrightness,
  };
}

export function brightnessToPercent(brightness: number) {
  return Math.round(((brightness - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * 100);
}

export function percentToBrightness(percent: number) {
  return Math.round((percent / 100) * (BRIGHTNESS_MAX - BRIGHTNESS_MIN) + BRIGHTNESS_MIN);
}

export function blurToPercent(blur: number) {
  return Math.round(((blur - BLUR_MIN) / (BLUR_MAX - BLUR_MIN)) * 100);
}

export function percentToBlur(percent: number) {
  return Math.round((percent / 100) * (BLUR_MAX - BLUR_MIN) + BLUR_MIN);
}

export function darkModeBrightnessToPercent(darkModeBrightness: number) {
  return Math.max(0, Math.min(50, darkModeBrightness));
}
