"use client";

import React from "react";
import WidgetColumnTemplate from "../templates/WidgetColumn";
import VerticalList from "../templates/VerticalList";

interface WidgetItemProps {
  className?: string;
}

export interface CalendarWidgetProps extends WidgetItemProps {
  startMonday?: boolean;
}

export default function CalendarWeekWidget({ startMonday = true, className = "" }: CalendarWidgetProps) {
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  if (startMonday) {
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(today.getDate() + diff);
  } else {
    startOfWeek.setDate(today.getDate() - dayOfWeek);
  }

  const week = Array.from({ length: 7 }).map((_, i) => {
    const day = new Date(startOfWeek);
    day.setDate(startOfWeek.getDate() + i);
    return day;
  });

  return (
    <WidgetColumnTemplate className={className}>
      {week.map((day) => {
        const isToday =
          day.getDate() === today.getDate() &&
          day.getMonth() === today.getMonth() &&
          day.getFullYear() === today.getFullYear();

        return (
          <div key={day.toDateString()} className="day p-1 flex flex-col items-center justify-center">
            <div
              className={`w-6 h-6 flex items-center justify-center rounded-full text-[clamp(0.8rem,2.5cqw,1.2rem)] ${isToday ? "bg-primary font-semibold" : "text-(--text-foreground)"
                }`}
            >
              {day.getDate()}
            </div>
            <div className="text-[clamp(0.7rem,2cqw,1rem)] mt-1 text-foreground">
              {daysOfWeek[day.getDay()][0]}
            </div>
          </div>
        );
      })}
    </WidgetColumnTemplate>
  );
}

export function CalendarTodayWidget({ className = "" }: WidgetItemProps) {
  const today = new Date();
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const weekday = daysOfWeek[today.getDay()];
  const month = months[today.getMonth()];
  const date = today.getDate();
  const year = today.getFullYear();

  return (
    <div className={`rounded-lg p-4 flex flex-col items-center justify-center text-center ${className}`}>
      <div className="text-foreground text-[clamp(0.6rem,1.5cqw,0.9rem)] font-medium">
        {weekday}
      </div>

      <div className="text-[clamp(1.5rem,4cqw,2rem)] font-semibold text-primary">
        {date}
      </div>

      <div className="text-(--text-foreground) text-[clamp(0.6rem,1.5cqw,0.9rem)]">
        {month} {year}
      </div>
    </div>
  );
}

export interface CalendarUpcomingItem {
  id: string;
  title: string;
  start: string;
  end?: string;
  isAllDay?: boolean;
  location?: string;
}

export interface CalendarUpcomingWidgetProps extends WidgetItemProps {
  items?: CalendarUpcomingItem[];
  maxItems?: number;
}

export function CalendarUpcomingWidget({ items = [], maxItems = 5, className = "" }: CalendarUpcomingWidgetProps) {
  const upcoming = items
    .filter((item) => new Date(item.start).getTime() >= new Date().setHours(0, 0, 0, 0)) // Show today's events too
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, maxItems);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  const resolved = {
    header: {
      title: "Upcoming Events",
      show: true,
      icon: "fa6-solid:calendar-days",
    },
    list: upcoming.map((item) => ({
      title: item.title,
      subtitle: [
        item.isAllDay ? "All day" : formatTime(item.start),
        item.location,
      ].filter(Boolean) as string[],
      group: formatDate(item.start),
    })),
    raw: {},
  };

  return <VerticalList resolved={resolved} className={className} />;
}