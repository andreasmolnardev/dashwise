"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadFont } from "@/lib/loadFont";
import useAuth from "@/context/useAuth";
import { renderWidget } from "../widgets/Widget";
import AppIcon from "@dashwise/app-icon";

export default function Screensaver(
  { active, onExit }: { active: boolean; onExit: () => void },
) {
  const { user } = useAuth();
  const [fonts, setFonts] = useState<{ name: string; path: string }[]>([]);
  const [screensaverConfig, setScreensaverConfig] = useState<any>(
    user?.screensaverPreferences,
  );
  const [isHovering, setIsHovering] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const index = Math.round(target.scrollLeft / target.clientWidth);
    if (index !== activeFrameIndex) {
      setActiveFrameIndex(index);
    }
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
        {frames.map((frame: any) => (
          <div
            key={frame.id}
            className="min-w-full h-full flex items-center justify-center snap-center relative"
          >
            <div className="scale-150 transform origin-center">
              {renderWidget({
                type: frame.type,
                params: frame.params || {},
                className: "overflow-visible",
              })}
            </div>
          </div>
        ))}
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
