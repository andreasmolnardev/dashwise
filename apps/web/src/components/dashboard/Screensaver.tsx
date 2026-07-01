"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadFont } from "@/lib/loadFont";
import useAuth from "@/context/useAuth";
import { renderWidget } from "../widgets/Widget";
import AppIcon from "@dashwise/app-icon";
import { fetchWallpaperBlob } from "@/lib/apiClient";

export default function Screensaver(
  { active, onExit }: { active: boolean; onExit: () => void },
) {
  const { user, token } = useAuth();
  const [fonts, setFonts] = useState<{ name: string; path: string }[]>([]);
  const [screensaverConfig, setScreensaverConfig] = useState<any>(
    user?.screensaverPreferences,
  );
  const [isHovering, setIsHovering] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [frameBackgrounds, setFrameBackgrounds] = useState<Record<string, string>>({});
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isHovering) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovering(false);
      }, 3000);
    }
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [isHovering]);

  useEffect(() => {
    fetch("/fonts/index.json")
      .then((res) => res.json())
      .then(setFonts);

    const checkLocal = () => {
      const local = localStorage.getItem("dashwise_screensaver_local");
      if (local) {
        setScreensaverConfig(JSON.parse(local));
      } else {
        setScreensaverConfig(user?.screensaverPreferences);
      }
    };

    checkLocal();
    window.addEventListener("dashwise_local_config_updated", checkLocal);
    return () =>
      window.removeEventListener("dashwise_local_config_updated", checkLocal);
  }, [user?.screensaverPreferences]);

  useEffect(() => {
    let wakeLock: any = null;
    if (active && "wakeLock" in navigator) {
      const requestWakeLock = async () => {
        try {
          wakeLock = await (navigator as any).wakeLock.request("screen");
        } catch (err) {
          console.error("Wake lock error", err);
        }
      };

      requestWakeLock();

      const handleVisibilityChange = () => {
        if (wakeLock && document.visibilityState === "visible") {
          requestWakeLock();
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
        if (wakeLock) {
          wakeLock.release().catch(() => undefined);
        }
      };
    }
  }, [active]);

  const useHomePageStyle = screensaverConfig?.useHomePageStyle ?? true;
  const homePageFont = user?.appearancePreferences?.clock?.defaultFont ||
    "MomoTrustDisplay";

  const clockFont = useHomePageStyle
    ? homePageFont
    : screensaverConfig?.clockFont || homePageFont;
  const clockFontWeight = useHomePageStyle
    ? "font-normal"
    : screensaverConfig?.clockFontWeight || "font-normal";
  const color = useHomePageStyle
    ? "rgba(255, 255, 255, 0.8)"
    : screensaverConfig?.color || "rgba(255, 255, 255, 0.8)";
  const size = useHomePageStyle ? 5 : screensaverConfig?.size || 9;

  useEffect(() => {
    if (clockFont) {
      const fontDetails = fonts.find((font) => font.name === clockFont);
      if (fontDetails) {
        loadFont(clockFont, fontDetails.path);
      }
    }
  }, [clockFont, fonts]);

  const frames = useMemo(() => {
    if (
      Array.isArray(screensaverConfig?.frames) &&
      screensaverConfig.frames.length > 0
    ) {
      return screensaverConfig.frames;
    }

    return [
      {
        id: "default-clock",
        type: "main-clock",
        params: {
          font: clockFont,
          weight: clockFontWeight.startsWith("font-")
            ? clockFontWeight.split("-")[1]
            : clockFontWeight,
          color,
          fontSize: `${size}rem`,
        },
      },
    ];
  }, [screensaverConfig, clockFont, clockFontWeight, color, size]);

  useEffect(() => {
    let cancelled = false;
    const revokeUrls: string[] = [];

    const resolveBackgrounds = async () => {
      const nextBackgrounds: Record<string, string> = {};

      await Promise.all(
        frames.map(async (frame: any) => {
          const source = String(frame?.params?.backgroundSource ?? "");
          if (source === "none") return;

          const rawUrl = source === "current"
            ? String(user?.appearancePreferences?.backgroundImageUrl ?? "")
            : String(frame?.params?.backgroundImageUrl ?? "");
          if (!rawUrl) return;

          if (
            rawUrl.startsWith("/api/v1/wallpapers") ||
            rawUrl.includes(window.location.host)
          ) {
            if (!token) return;
            try {
              const blob = await fetchWallpaperBlob(rawUrl, token);
              const objectUrl = URL.createObjectURL(blob);
              revokeUrls.push(objectUrl);
              nextBackgrounds[frame.id] = objectUrl;
            } catch (err) {
              console.error("Failed to load frame background", err);
            }
            return;
          }

          nextBackgrounds[frame.id] = rawUrl;
        })
      );

      if (!cancelled) setFrameBackgrounds(nextBackgrounds);
    };

    void resolveBackgrounds();

    return () => {
      cancelled = true;
      revokeUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [frames, token, user?.appearancePreferences?.backgroundImageUrl]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const index = Math.round(target.scrollLeft / target.clientWidth);
    if (index !== activeFrameIndex) {
      setActiveFrameIndex(index);
    }
    setScrollLeft(target.scrollLeft);
  };

  const scrollToFrame = (index: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      left: index * scrollRef.current.clientWidth,
      behavior: "smooth",
    });
  };

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 bg-black backdrop-blur-xl z-50 flex flex-col"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseMove={() => setIsHovering(true)}
    >
      <div
        ref={scrollRef}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory hide-scrollbar"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        onScroll={handleScroll}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: ".hide-scrollbar::-webkit-scrollbar { display: none; }",
          }}
        />
        {frames.map((frame: any, idx: number) => {
          const containerWidth = scrollRef.current?.clientWidth ?? 1;
          const distance = Math.abs(scrollLeft - idx * containerWidth) / containerWidth;
          const clamped = Math.min(1, Math.max(0, distance));
          const scale = 1 - 0.1 * clamped;
          const showRadius = clamped > 0.001;
          const filters = frame.params?.backgroundFilters as Record<string, any> | undefined;
          const fallbackFilters = user?.appearancePreferences?.wallpaperFilters;
          const blurValue = typeof filters?.blur === "number"
            ? filters.blur
            : typeof fallbackFilters?.blur === "number"
              ? fallbackFilters.blur
              : 3;
          const brightnessValue = typeof filters?.brightness === "number"
            ? filters.brightness
            : typeof fallbackFilters?.brightness === "number"
              ? fallbackFilters.brightness
              : 85;
          const backgroundUrl = frameBackgrounds[frame.id];
          const layoutGrid = frame.params?.layoutGrid as Record<string, any> | undefined;
          const gridRows = Number(layoutGrid?.rows) || 1;
          const gridColumns = Number(layoutGrid?.columns) || 1;
          const gridCells = Array.isArray(layoutGrid?.cells) ? layoutGrid.cells : [];
          const widgetParams = { ...(frame.params || {}) };
          delete widgetParams.layoutGrid;
          delete widgetParams.backgroundImageUrl;
          delete widgetParams.backgroundSource;
          delete widgetParams.backgroundFilters;

          return (
            <div
              key={frame.id}
              className={`min-w-full h-full flex items-center justify-center snap-center relative overflow-hidden border border-white/10 transition-transform duration-200 ease-out ${
                showRadius ? "rounded-3xl" : "rounded-none"
              }`}
              style={{ transform: `scale(${scale})` }}
            >
              {backgroundUrl && (
                <div
                  className="absolute inset-0 z-0"
                  style={{
                    backgroundImage: `url('${backgroundUrl}')`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: `blur(${blurValue}px) brightness(${brightnessValue}%)`,
                  }}
                />
              )}
              {gridCells.length > 0 ? (
                <div
                  className="relative z-10 grid h-full w-full gap-8 p-12"
                  style={{
                    gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                  }}
                >
                  {gridCells.map((cell: any, cellIndex: number) => (
                    <div
                      key={String(cell?.id ?? cellIndex)}
                      className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 rounded-3xl border border-white/10 bg-black/10 p-6 backdrop-blur-sm"
                    >
                      {cell?.name && (
                        <div className="text-xs font-medium uppercase tracking-[0.25em] text-white/50">
                          {String(cell.name)}
                        </div>
                      )}
                      <div className="scale-125 transform origin-center">
                        {renderWidget({
                          type: String(cell?.widget ?? frame.type),
                          params: {
                            ...widgetParams,
                            ...((cell as any)?.params || {}),
                          },
                          className: "overflow-visible",
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative z-10 scale-150 transform origin-center">
                  {renderWidget({
                    type: frame.type,
                    params: widgetParams,
                    className: "overflow-visible",
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        className={`absolute bottom-0 left-0 right-0 p-8 flex justify-center items-center pointer-events-none transition-opacity duration-300 ${
          isHovering ? "opacity-100" : "opacity-0"
        }`}
      >
        {frames.length > 1 && (
          <div className="flex gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full pointer-events-auto border border-white/10">
            {frames.map((_: any, idx: number) => (
              <button
                key={idx}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  idx === activeFrameIndex
                    ? "bg-white scale-125"
                    : "bg-white/40 hover:bg-white/60"
                }`}
                onClick={() => scrollToFrame(idx)}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className={`absolute bottom-8 right-8 transition-opacity duration-300 group ${
          isHovering ? "opacity-100" : "opacity-0"
        }`}
        onClick={onExit}
      >
        <AppIcon
          source="fa6-solid:xmark"
          className="w-12 h-12 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 transition-all pointer-events-auto group-hover:text-primary"
        />
      </div>
    </div>
  );
}
