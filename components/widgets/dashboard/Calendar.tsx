import React from "react";
import { WidgetItemProps } from "../Widget";
import WidgetColumnTemplate from "../templates/WidgetColumn";


interface CalendarWidgetProps extends WidgetItemProps {
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
              className={`w-6 h-6 flex items-center justify-center rounded-full text-[clamp(0.8rem,2.5cqw,1.2rem)] ${isToday ? "bg-(--primary) font-semibold" : "text-(--text-on-frosted)"
                }`}
            >
              {day.getDate()}
            </div>
            <div className="text-[clamp(0.7rem,2cqw,1rem)] mt-1 text-(--text-primary)">
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
      <div className="text-(--text-primary) text-[clamp(0.6rem,1.5cqw,0.9rem)] font-medium">
        {weekday}
      </div>

      <div className="text-[clamp(1.5rem,4cqw,2rem)] font-semibold text-(--primary)">
        {date}
      </div>

      <div className="text-(--text-on-frosted) text-[clamp(0.6rem,1.5cqw,0.9rem)]">
        {month} {year}
      </div>
    </div>

  );
}
