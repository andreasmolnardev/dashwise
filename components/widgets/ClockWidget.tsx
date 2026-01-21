"use client";
import { useConfig } from "@/context/ConfigContext";
import { loadFont } from "@/lib/loadFont";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type ClockWidgetProps = {
  format?: "24h" | "12h";
  font?: string;
  weight?: string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
};

type FontEntry = {
  name: string;
  path: string;
};

export default function ClockWidget({ format = "24h", font: propFont, weight, color, className, style }: ClockWidgetProps) {
  const [time, setTime] = useState("");
  const { config } = useConfig();

  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [internalFont, setInternalFont] = useState<FontEntry>();

  // Fetch font list and add "Default" option
  useEffect(() => {
    let mounted = true;
    fetch("/fonts/index.json")
      .then((r) => r.json())
      .then((data: FontEntry[]) => {
        if (!mounted) return;
        const fixed = data.map((f: FontEntry) => ({ name: f.name, path: f.path }));
        setFonts([{ name: "Default", path: "" }, ...fixed]);
        
        const fontNameToUse = propFont || config?.appearance?.clock?.defaultFont;
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
  }, [propFont, config?.appearance?.clock?.defaultFont]);


  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: format === "12h",
      };
      setTime(now.toLocaleTimeString([], options));
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [format]);

  return (
    <div
      className={cn(
        "text-6xl text-center p-4",
        internalFont?.name === "Default" ? "font-semibold" : "font-medium",
        className
      )}
      style={{
        fontFamily: internalFont?.name !== "Default" ? `"${internalFont?.name}", system-ui` : undefined,
        fontWeight: weight,
        color: color,
        ...style
      }}
    >
      {time}
    </div>
  );
}
