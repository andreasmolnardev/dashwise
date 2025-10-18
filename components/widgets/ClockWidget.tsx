"use client";

import { useEffect, useState } from "react";

type ClockWidgetProps = {
  format?: "24h" | "12h";
};

export default function ClockWidget({ format = "24h" }: ClockWidgetProps) {
  const [time, setTime] = useState("");

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

    updateTime(); // initial render
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [format]);

  return (
    <div className="font-semibold text-6xl text-center p-4">
      {time}
    </div>
  );
}
