"use client";

import { createContext, ReactNode, useContext, useMemo } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";

type TimeFormatPreference = "12-hour" | "24-hour";
type TemperatureUnit = "c" | "f";

type FormatTemperatureOptions = {
  includeUnit?: boolean;
  decimals?: number;
};

type LocalizationContextType = {
  locale: string;
  timeFormat: TimeFormatPreference;
  dateFormat: string;
  weatherUnit: TemperatureUnit;
  weatherUnitSymbol: "°C" | "°F";
  toPreferredTemperature: (value: number, inputUnit?: string) => number;
  formatTemperature: (value: number | null | undefined, inputUnit?: string, opts?: FormatTemperatureOptions) => string;
  formatTime: (date?: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatDate: (date?: Date | string | number, overrideFormat?: string) => string;
  refresh: () => void;
};

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

function normalizeTimeFormat(value: unknown): TimeFormatPreference {
  if (value === "12-hour" || value === "12h" || value === 12 || value === "12") {
    return "12-hour";
  }
  return "24-hour";
}

function normalizeUnit(value: unknown): TemperatureUnit {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "f" || raw === "°f" || raw === "fahrenheit") return "f";
  return "c";
}

function getBrowserLocale() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
}

function toDate(input?: Date | string | number): Date {
  if (!input) return new Date();
  return input instanceof Date ? input : new Date(input);
}

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const { refreshConfig } = usePageConfig();
  const { user } = useAuth();

  const localizationPreferences = user?.localizationPreferences ?? {};

  const locale = localizationPreferences.locale || getBrowserLocale();
  const timeFormat = normalizeTimeFormat(
    localizationPreferences.timeFormat ?? localizationPreferences["time-format"]
  );
  const dateFormat = localizationPreferences.dateFormat || "DD-MM-YYYY";
  const weatherUnit = normalizeUnit(localizationPreferences.weatherUnit);

  const value = useMemo<LocalizationContextType>(() => {
    const weatherUnitSymbol: "°C" | "°F" = weatherUnit === "f" ? "°F" : "°C";

    const toPreferredTemperature = (input: number, inputUnit: string = "c") => {
      if (!Number.isFinite(input)) return input;
      const from = normalizeUnit(inputUnit);
      const converted = from === weatherUnit ? input : (weatherUnit === "f" ? (input * 9) / 5 + 32 : ((input - 32) * 5) / 9);
      return Math.round(converted);
    };

    const formatTemperature = (
      rawValue: number | null | undefined,
      inputUnit: string = "c",
      opts?: FormatTemperatureOptions
    ) => {
      if (rawValue === null || rawValue === undefined || !Number.isFinite(Number(rawValue))) return "—";
      const value = toPreferredTemperature(Number(rawValue), inputUnit);
      const decimals = opts?.decimals ?? 0;
      const localizedNumber = value.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      if (opts?.includeUnit === false) return localizedNumber;
      return `${localizedNumber}${weatherUnitSymbol}`;
    };

    const formatTime = (input?: Date | string | number, opts?: Intl.DateTimeFormatOptions) => {
      const date = toDate(input);
      return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: timeFormat === "12-hour",
        ...opts,
      }).format(date);
    };

    const formatDate = (input?: Date | string | number, overrideFormat?: string) => {
      const date = toDate(input);
      const pattern = overrideFormat || dateFormat;

      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const monthShort = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
      const monthLong = new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
      const year = String(date.getFullYear());

      const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
      const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);

      return pattern
        .replace("dddd", weekdayLong)
        .replace("ddd", weekdayShort)
        .replace("mmmm", monthLong)
        .replace("mmm", monthShort)
        .replace("DD", day)
        .replace("MM", month)
        .replace("YYYY", year)
        .trim();
    };

    return {
      locale,
      timeFormat,
      dateFormat,
      weatherUnit,
      weatherUnitSymbol,
      toPreferredTemperature,
      formatTemperature,
      formatTime,
      formatDate,
      refresh: refreshConfig,
    };
  }, [dateFormat, locale, timeFormat, weatherUnit, refreshConfig]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization() {
  const ctx = useContext(LocalizationContext);
  if (!ctx) throw new Error("useLocalization must be used inside LocalizationProvider");
  return ctx;
}
