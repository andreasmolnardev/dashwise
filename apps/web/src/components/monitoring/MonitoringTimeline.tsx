"use client";

import { useMemo } from "react";

type TimelineSegment = {
  type: "state" | "time" | "now";
  status?: "up" | "down";
  date?: Date;
  flex: number;
};

type MonitoringTimelineProps = {
  status?: string | null;
  dateChanged?: string | null;
  durationChanged?: number | null;
};

function formatDate(date: Date) {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }`;
}

function normalizeState(status?: string | null): "up" | "down" {
  return status === "healthy" ? "up" : "down";
}

function formatStateLabel(status?: "up" | "down") {
  return status === "up" ? "Up" : "Down";
}

export default function MonitoringTimeline(
  { status, dateChanged, durationChanged }: MonitoringTimelineProps,
) {
  const segments = useMemo<TimelineSegment[]>(() => {
    const now = new Date();
    const changeTime = dateChanged ? new Date(dateChanged) : null;
    const changeDuration = durationChanged ?? 0;
    const currentState = normalizeState(status);
    const timelineSegments: TimelineSegment[] = [];

    if (changeTime && changeDuration > 0) {
      const previousState = currentState === "up" ? "down" : "up";
      const previousStartTime = new Date(
        changeTime.getTime() - changeDuration * 1000,
      );

      const currentDuration = now.getTime() - changeTime.getTime();
      const previousDurationMs = changeDuration * 1000;

      const longerFlex = 3;
      const shorterFlex = 2;
      const [beforeFlex, currentFlex] = currentDuration >= previousDurationMs
        ? [shorterFlex, longerFlex]
        : [longerFlex, shorterFlex];

      timelineSegments.push(
        { type: "state", status: currentState, flex: 1 },
        { type: "time", date: previousStartTime, flex: 0 },
        { type: "state", status: previousState, flex: beforeFlex },
        { type: "time", date: changeTime, flex: 0 },
        { type: "state", status: currentState, flex: currentFlex },
        { type: "now", flex: 0 },
      );
    } else {
      timelineSegments.push(
        { type: "state", status: currentState, flex: 1 },
        { type: "now", flex: 0 },
      );
    }

    return timelineSegments;
  }, [dateChanged, durationChanged, status]);

  return (
    <div>
      <div className="text-xl font-semibold mb-2">Recent Activity</div>

      <div className="flex items-stretch gap-2 h-8">
        {segments.map((segment, i) => {
          if (segment.type === "state") {
            const bgColor = segment.status === "up"
              ? "bg-green-500/40"
              : "bg-red-500/40";

            return (
              <div
                key={i}
                className={`rounded border border-white/20 ${bgColor}
        flex items-center justify-center text-sm font-medium
        transition-transform duration-200 ease-out
        hover:scale-102 hover:z-10`}
                style={{ flex: segment.flex }}
              >
                {formatStateLabel(segment.status)}
              </div>
            );
          }

          if (segment.type === "time" && segment.date) {
            return (
              <div
                key={i}
                className="rounded bg-white/10 border border-white/30
        flex items-center justify-center px-1 text-sm font-medium
        whitespace-nowrap overflow-visible
        transition-transform duration-200 ease-out
        hover:scale-110 hover:z-10"
                style={{ minWidth: "14px", maxWidth: "14px" }}
                title={segment.date.toLocaleString()}
              >
                <span className="relative">
                  {formatDate(segment.date)}
                </span>
              </div>
            );
          }

          if (segment.type === "now") {
            return (
              <div
                key={i}
                className="rounded bg-blue-500/30 border border-blue-400/50
        flex items-center justify-end px-0.5 text-sm font-semibold
        transition-transform duration-200 ease-out
        hover:scale-110 hover:z-10"
                style={{ minWidth: "14px", maxWidth: "14px" }}
              >
                Now
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
