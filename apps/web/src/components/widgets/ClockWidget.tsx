"use client";
import { useLocalization } from "@/context/LocalizationContext";
import { loadFont } from "@/lib/loadFont";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ClockAppearance } from "../settings/ClockFontSelectionCarousel";
import useAuth from "@/context/useAuth";

type ClockWidgetProps = {
  format?: "24h" | "12h";
  font?: string;
  weight?: string | number;
  color?: string;
  letterSpacing?: number;
  opacity?: number;
  outlineEnabled?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  className?: string;
  style?: React.CSSProperties;
};

type FontEntry = {
  name: string;
  path: string;
};

export default function ClockWidget({
  format,
  font: propFont,
  weight,
  color: propColor,
  letterSpacing,
  opacity,
  outlineEnabled,
  outlineColor,
  outlineWidth,
  className,
  style,
}: ClockWidgetProps) {
  const [time, setTime] = useState("");
  const { user } = useAuth();
  const { formatTime, timeFormat } = useLocalization();

  const [internalFont, setInternalFont] = useState<FontEntry>();

  const clockAppearance = user?.appearancePreferences?.clock as ClockAppearance | undefined;

  // Fetch font list and add "Default" option
  useEffect(() => {
    let mounted = true;
    fetch("/fonts/index.json")
      .then((r) => r.json())
      .then((data: FontEntry[]) => {
        if (!mounted) return;
        const fixed = data.map((f: FontEntry) => ({ name: f.name, path: f.path }));
        const fontNameToUse = propFont || clockAppearance?.defaultFont;
        const foundFont = fixed.find(item => (item.name === fontNameToUse));
        
        if (foundFont) {
          loadFont(foundFont.name, foundFont.path);
          setInternalFont(foundFont);
        } else {
          setInternalFont({ name: "Default", path: "" });
        }
      })
      .catch((e) => console.error("Failed to load fonts", e));

    return () => {
      mounted = false;
    };
  }, [propFont, clockAppearance?.defaultFont]);


  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const resolvedFormat = format || (timeFormat === "12-hour" ? "12h" : "24h");
      setTime(formatTime(now, { hour12: resolvedFormat === "12h" }));
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [format, formatTime, timeFormat]);

  const finalStyle: React.CSSProperties = {
    fontFamily: internalFont?.name !== "Default" ? `"${internalFont?.name}", system-ui` : undefined,
    fontWeight: weight ?? clockAppearance?.fontWeight ?? (internalFont?.name === "Default" ? 600 : 500),
    letterSpacing: letterSpacing ?? clockAppearance?.letterSpacing ? `${letterSpacing ?? clockAppearance?.letterSpacing}px` : undefined,
    color: propColor ?? clockAppearance?.color,
    opacity: opacity ?? clockAppearance?.opacity,
    ...(style ?? {}),
  };

  const letterStyle: React.CSSProperties = {
    display: "inline-block",
    position: "relative",
    ...((outlineEnabled ?? clockAppearance?.outlineEnabled) ? {
      WebkitTextStroke: `${outlineWidth ?? clockAppearance?.outlineWidth ?? 1}px ${outlineColor ?? clockAppearance?.outlineColor ?? "#000000"}`,
      textStroke: `${outlineWidth ?? clockAppearance?.outlineWidth ?? 1}px ${outlineColor ?? clockAppearance?.outlineColor ?? "#000000"}`,
    } : {}),
  };

  return (
    <div
      className={cn(
        "text-6xl text-center p-4",
        className
      )}
      style={finalStyle}
    >
      {time.split("").map((char, i) => (
        <span key={i} style={char !== " " ? letterStyle : { margin: "0 4px" }}>
          {char}
        </span>
      ))}
    </div>
  );
}
