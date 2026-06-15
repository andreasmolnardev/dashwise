"use client";

import { useEffect, useState } from "react";
import { Progress } from "@dashwise/integrationskit/templates/shadcn-components/progress";

type ProgressType = "day" | "week" | "month" | "year";

type ProgressWidgetProps = {
  type: ProgressType;
  className?: string;
  showLabel?: boolean;
  showPercentage?: boolean;
};

const LABELS: Record<ProgressType, string> = {
  day: "Day Progress",
  week: "Week Progress",
  month: "Month Progress",
  year: "Year Progress",
};

function calcProgress(type: ProgressType): number {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msInDay = 24 * 60 * 60 * 1000;

  switch (type) {
    case "day": {
      const elapsed = now.getTime() - startOfDay.getTime();
      return (elapsed / msInDay) * 100;
    }
    case "week": {
      const dayOfWeek = now.getDay();
      const sunday = new Date(startOfDay);
      sunday.setDate(sunday.getDate() - dayOfWeek);
      const elapsed = now.getTime() - sunday.getTime();
      return (elapsed / (7 * msInDay)) * 100;
    }
    case "month": {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const elapsed = now.getDate() - 1 + (now.getTime() - startOfDay.getTime()) / msInDay;
      return (elapsed / daysInMonth) * 100;
    }
    case "year": {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const daysInYear = ((new Date(now.getFullYear() + 1, 0, 1).getTime() - startOfYear.getTime()) / msInDay);
      const elapsed = (now.getTime() - startOfYear.getTime()) / msInDay;
      return (elapsed / daysInYear) * 100;
    }
  }
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function calcProgressPct(type: ProgressType): number {
  return calcProgress(type);
}

export function formatProgressPct(type: ProgressType): string {
  return formatPct(calcProgress(type));
}

export default function ProgressWidget({
  type,
  className = "",
  showLabel = true,
  showPercentage = true,
}: ProgressWidgetProps) {
  const [progress, setProgress] = useState(() => calcProgress(type));

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(calcProgress(type));
    }, 60000);
    return () => clearInterval(interval);
  }, [type]);

  return (
    <div className={`frosted rounded-lg p-3 flex items-center justify-center flex-col ${className}`}>
      {showLabel && (
        <div className="flex items-center justify-between w-full mb-2">
          <span className="text-sm font-medium">{LABELS[type]}</span>
          {showPercentage && (
            <span className="text-sm font-semibold tabular-nums">
              {formatPct(progress)}
            </span>
          )}
        </div>
      )}
      {!showLabel && showPercentage && (
        <div className="flex items-center justify-end mb-1">
          <span className="text-sm font-semibold tabular-nums">
            {formatPct(progress)}
          </span>
        </div>
      )}
      <Progress value={Math.round(progress)} />
    </div>
  );
}
