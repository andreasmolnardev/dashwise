"use client";

import React, { useEffect, useState } from "react";
import {
  differenceInCalendarDays,
  format,
  isValid,
  parse,
  parseISO,
  startOfDay,
} from "date-fns";
import ItemDetailsCard from "../templates/ItemDetailsCard";
import type { ResolvedWidget } from "../types";

interface CountdownWidgetProps {
  className?: string;
  date?: string | { default?: string };
  display_name?: string;
  displayName?: string;
  date_format?: string;
  dateFormat?: string;
  icon?: string;
  title?: string;
}

export default function CountdownWidget({
  className = "",
  date,
  display_name,
  displayName,
  date_format,
  dateFormat,
  icon,
  title,
}: CountdownWidgetProps) {
  const inputDate = typeof date === "string"
    ? date.trim()
    : date && typeof date === "object" && typeof date.default === "string"
      ? date.default.trim()
      : "";
  const parsedTargetDate = parseCountdownDate(inputDate, date_format ?? dateFormat);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setToday(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const daysLeft = parsedTargetDate
    ? differenceInCalendarDays(startOfDay(parsedTargetDate), startOfDay(today))
    : null;

  const eventName = (display_name ?? displayName ?? title ?? "Event").trim() || "Event";
  const formattedDate = parsedTargetDate
    ? format(parsedTargetDate, "PPP")
    : inputDate || "invalid date";
  const countdownText =
    daysLeft === null
      ? "Invalid date"
      : daysLeft === 0
        ? "0 days left"
        : daysLeft === 1
          ? "1 day left"
          : daysLeft > 1
            ? `${daysLeft} days left`
            : `${Math.abs(daysLeft)} days since`;

  const resolved: ResolvedWidget = {
    header: {
      title: "Countdown",
      show: true,
      icon: "solar:calendar-bold",
    },
    card: {
      primary: eventName,
      secondary: `${countdownText} (${formattedDate})`,
    },
    raw: {
      date,
      display_name: display_name ?? displayName,
      date_format: date_format ?? dateFormat,
      icon,
      title,
    },
  };

  return <ItemDetailsCard resolved={resolved} className={className} />;
}

function parseCountdownDate(value: string, dateFormat?: string): Date | null {
  if (!value) return null;

  if (dateFormat) {
    const normalizedFormat = normalizeDateFormat(dateFormat);
    const parsed = parse(value, normalizedFormat, new Date());
    if (isValid(parsed)) return parsed;
  }

  const isoParsed = parseISO(value);
  if (isValid(isoParsed)) return isoParsed;

  const fallback = new Date(value);
  return isValid(fallback) ? fallback : null;
}

function normalizeDateFormat(formatString: string) {
  return formatString
    .replace(/YYYY/g, "yyyy")
    .replace(/YY/g, "yy")
    .replace(/DD/g, "dd")
    .replace(/D/g, "d")
    .replace(/HH/g, "HH")
    .replace(/hh/g, "hh")
    .replace(/mm/g, "mm")
    .replace(/ss/g, "ss");
}