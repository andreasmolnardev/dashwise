"use client";
import { useConfig } from "@/context/ConfigContext";
import { loadFont } from "@/lib/loadFont";
import { useEffect, useState } from "react";

type ClockWidgetProps = {
  format?: "24h" | "12h";
};


type FontEntry = {
  name: string;
  path: string;
};

export default function ClockWidget({ format = "24h" }: ClockWidgetProps) {
  const [time, setTime] = useState("");
  const { config, refreshConfig } = useConfig();  

    const [fonts, setFonts] = useState<FontEntry[]>([]);
    const [font, setFont] = useState<FontEntry>();
  
    // Fetch font list and add "Default" option
    useEffect(() => {
      let mounted = true;
      fetch("/fonts/index.json")
        .then((r) => r.json())
        .then((data: FontEntry[]) => {
          if (!mounted) return;
          const fixed = data.map((f) => ({ name: f.name, path: f.path }));
          setFonts([{ name: "Default", path: "" }, ...fixed]);
          const font = fixed.find(item => (item.name == (config?.appearance?.clock?.defaultFont)))
          loadFont(font?.name ?? "Default", font?.path)
          setFont(font)
        })
        .catch((e) => console.error("Failed to load fonts", e));
  
      return () => {
        mounted = false;
      };
    }, []);
  

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
      className="font-semibold text-6xl text-center p-4"
       style={{
                fontFamily: font?.name !== "Default" ? `"${font?.name}", system-ui` : undefined,
              }}
    >
      {time}
    </div>
  );
}
