import React, { useEffect, useState } from "react";
import type { WidgetItemProps } from "../Widget";

interface WeatherWidgetParams {
  locationCoordinates?: string;
  locationDisplayname?: string;
  unit?: string;
  showLocation?: boolean;
}

export type WeatherWidgetProps = WidgetItemProps & {
  params?: WeatherWidgetParams;
};

interface HourlyItem {
  time: string;
  temperature?: number;
  precipitation?: number;
  precipitationProbability?: number;
  weatherCode?: number;
}

interface SimpleForecast {
  temperature?: number;
  description?: string;
  iconUrl?: string;
  precipitation?: number;
  precipitationProbability?: number;
}

interface WeatherData {
  temperature?: number;
  weatherCode?: number;
  description?: string;
  iconUrl?: string;
  unit?: string;
  windSpeed?: number;
  windDirection?: number;
  humidity?: number;
  precipitation?: number;
  precipitationProbability?: number;
  rainMessage?: string;
  tonight?: SimpleForecast;
  tomorrow?: SimpleForecast;
  hourly?: HourlyItem[];
  error?: string;
}

/* minimal weather code -> icon/desc map */
const WEATHER_CODE_MAP: Record<number, { file: string; desc: string }> = {
  0: { file: "glass-sun-96.png", desc: "Clear sky" },
  1: { file: "glass-clear-night-96.png", desc: "Mainly clear" },
  2: { file: "glass-day-cloudy-96.png", desc: "Partly cloudy" },
  3: { file: "glass-cloud-96.png", desc: "Overcast" },
  45: { file: "glass-clouds-100.png", desc: "Fog" },
  48: { file: "glass-clouds-100.png", desc: "Rime fog" },
  51: { file: "glass-rain-96.png", desc: "Light drizzle" },
  53: { file: "glass-rain-96.png", desc: "Moderate drizzle" },
  55: { file: "glass-rain-96.png", desc: "Dense drizzle" },
  56: { file: "glass-sleet-96.png", desc: "Freezing drizzle" },
  57: { file: "glass-sleet-96.png", desc: "Freezing drizzle (heavy)" },
  61: { file: "glass-rain-96.png", desc: "Slight rain" },
  63: { file: "glass-rain-96.png", desc: "Moderate rain" },
  65: { file: "glass-rain-cloud-96.png", desc: "Heavy rain" },
  66: { file: "glass-sleet-96.png", desc: "Freezing rain" },
  67: { file: "glass-sleet-96.png", desc: "Freezing rain (heavy)" },
  71: { file: "glass-snow-96.png", desc: "Slight snow" },
  73: { file: "glass-snow-96.png", desc: "Moderate snow" },
  75: { file: "glass-snow-96.png", desc: "Heavy snow" },
  80: { file: "glass-rain-96.png", desc: "Slight showers" },
  81: { file: "glass-rain-96.png", desc: "Moderate showers" },
  82: { file: "glass-storm-96.png", desc: "Violent showers" },
  95: { file: "glass-storm-96.png", desc: "Thunderstorm" },
  96: { file: "glass-storm-96.png", desc: "Thunderstorm with slight hail" },
  99: { file: "glass-storm-96.png", desc: "Thunderstorm with heavy hail" },
};

export function getWeatherIcon(
  description = "",
  iconUrl?: string,
  weatherCode?: number,
  size = 48
) {
  if (iconUrl && /^(https?:\/\/|\/)/.test(iconUrl)) {
    return <img src={iconUrl} alt={description} width={size} height={size} style={{ display: "inline-block", opacity: 0.85 }} />;
  }

  if (typeof weatherCode === "number" && WEATHER_CODE_MAP[weatherCode]) {
    const file = WEATHER_CODE_MAP[weatherCode].file;
    return <img src={`/weather-icons/${file}`} alt={WEATHER_CODE_MAP[weatherCode].desc} width={size} height={size} style={{ display: "inline-block" }} />;
  }

  const s = (description || "").toLowerCase();
  if (s.includes("clear") || s.includes("sun")) return <img src="/weather-icons/glass-sun-96.png" alt={description} width={size} height={size} />;
  if (s.includes("day") && s.includes("cloud")) return <img src="/weather-icons/glass-day-cloudy-96.png" alt={description} width={size} height={size} />;
  if (s.includes("cloud")) return <img src="/weather-icons/glass-cloud-96.png" alt={description} width={size} height={size} />;
  if (s.includes("rain") || s.includes("shower")) return <img src="/weather-icons/glass-rain-96.png" alt={description} width={size} height={size} />;
  if (s.includes("sleet")) return <img src="/weather-icons/glass-sleet-96.png" alt={description} width={size} height={size} />;
  if (s.includes("snow")) return <img src="/weather-icons/glass-snow-96.png" alt={description} width={size} height={size} />;
  if (s.includes("storm") || s.includes("thunder")) return <img src="/weather-icons/glass-storm-96.png" alt={description} width={size} height={size} />;

  return <img src="/weather-icons/glass-clouds-100.png" alt={description} width={size} height={size} />;
}

const parseNumber = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function computeRainMessageFromHourly(hourly?: HourlyItem[], now = new Date()): string | undefined {
  if (!hourly || hourly.length === 0) return undefined;
  const nowTs = now.getTime();
  const thresholdMm = 0.1;
  const thresholdProb = 30;
  for (let i = 0; i < hourly.length; i++) {
    const item = hourly[i];
    const precip = item.precipitation ?? 0;
    const prob = item.precipitationProbability ?? 0;
    if (precip > thresholdMm || prob >= thresholdProb) {
      const t = new Date(item.time).getTime();
      const diffMs = t - nowTs;
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      if (diffHours <= 0) return "It is raining now";
      if (diffHours === 1) return "Rain starts in about an hour";
      return `Rain starts in ${diffHours} hours`;
    }
  }
  return "No rain expected soon";
}

export default function WeatherWidget({ className = "", params }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      setLoading(true);
      try {
        const coords = (params?.locationCoordinates ?? "").split(",").map((s) => s.trim());
        const lat = coords[0];
        const lon = coords[1];
        const unit = params?.unit || "c";

        if (!lat || !lon) {
          setWeather({ error: "Missing lat/lon" });
          return;
        }

        const res = await fetch(`/api/v1/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&unit=${encodeURIComponent(unit)}`);
        const raw = await res.json();

        if (!res.ok) {
          setWeather({ error: raw?.error ?? `Upstream error ${res.status}` });
          return;
        }

        const normalized: WeatherData = {
          temperature: parseNumber(raw.temperature),
          weatherCode: parseNumber(raw.weatherCode),
          description: raw.description ?? (raw.weatherCode ? (WEATHER_CODE_MAP[Number(raw.weatherCode)]?.desc ?? "") : ""),
          iconUrl: raw.iconUrl,
          unit: raw.unit ?? (unit.toLowerCase() === "f" ? "°F" : "°C"),
          windSpeed: parseNumber(raw.windSpeed),
          windDirection: parseNumber(raw.windDirection),
          humidity: parseNumber(raw.humidity),
          precipitation: parseNumber(raw.precipitation),
          precipitationProbability: parseNumber(raw.precipitationProbability),
          tonight: raw.tonight ? {
            temperature: parseNumber(raw.tonight.temperature),
            description: raw.tonight.description ?? (raw.tonight.weatherCode ? WEATHER_CODE_MAP[Number(raw.tonight.weatherCode)]?.desc : undefined),
            iconUrl: raw.tonight.iconUrl,
            precipitation: parseNumber(raw.tonight.precipitation),
            precipitationProbability: parseNumber(raw.tonight.precipitationProbability),
          } : undefined,
          tomorrow: raw.tomorrow ? {
            temperature: parseNumber(raw.tomorrow.temperature),
            description: raw.tomorrow.description ?? (raw.tomorrow.weatherCode ? WEATHER_CODE_MAP[Number(raw.tomorrow.weatherCode)]?.desc : undefined),
            iconUrl: raw.tomorrow.iconUrl,
            precipitation: parseNumber(raw.tomorrow.precipitation),
            precipitationProbability: parseNumber(raw.tomorrow.precipitationProbability),
          } : undefined,
          hourly: Array.isArray(raw.hourly) ? raw.hourly.map((h: any) => ({
            time: h.time,
            temperature: parseNumber(h.temperature),
            precipitation: parseNumber(h.precipitation),
            precipitationProbability: parseNumber(h.precipitationProbability),
            weatherCode: parseNumber(h.weatherCode),
          })) : undefined,
          rainMessage: raw.rainMessage,
        };

        if (!normalized.rainMessage) {
          normalized.rainMessage = computeRainMessageFromHourly(normalized.hourly);
        }

        setWeather(normalized);
      } catch {
        setWeather({ error: "Failed to fetch weather data" });
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, [params]);

  if (loading) return <div className={className}>Loading weather...</div>;
  if (!weather || weather.error) return <div className={className}>Error: {weather?.error}</div>;

  const columns = [
    { label: "Now", data: weather },
    { label: "Tonight", data: weather.tonight },
    { label: "Tomorrow", data: weather.tomorrow },
  ];

  return (
    <div className={`${className} gap-2 flex-col justify-center`}>
      {params?.showLocation && <h3 className="w-full text-center text-sm">{params.locationDisplayname}</h3>}
      <div className="grid grid-cols-3 gap-2 w-full">
        {columns.map(
          (col, idx) =>
            col.data && (
              <div key={idx} className="flex flex-col items-center text-center text-xs">
                <strong className="text-sm">{col.label}</strong>
                <div className="text-xl my-1">
                  {idx === 0
                    ? getWeatherIcon(weather.description ?? "", weather.iconUrl, weather.weatherCode, 32)
                    : getWeatherIcon(col.data.description ?? "", col.data.iconUrl, (col.data as any).weatherCode, 32)}
                </div>
                <div>{col.data.temperature ?? "—"}{weather.unit} - {col.data.precipitationProbability}%</div>

              </div>
            )
        )}
      </div>
    </div>
  );
}

export function WeatherOverviewWidget({ className = "", params }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      setLoading(true);
      try {
        const coords = (params?.locationCoordinates ?? "").split(",").map((s) => s.trim());
        const lat = coords[0];
        const lon = coords[1];
        const unit = params?.unit || "c";

        if (!lat || !lon) {
          setWeather({ error: "Missing lat/lon" });
          return;
        }

        const res = await fetch(`/api/v1/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&unit=${encodeURIComponent(unit)}`);
        const raw = await res.json();

        if (!res.ok) {
          setWeather({ error: raw?.error ?? `Upstream error ${res.status}` });
          return;
        }

        const normalized: WeatherData = {
          temperature: parseNumber(raw.temperature),
          weatherCode: parseNumber(raw.weatherCode),
          description: raw.description ?? (raw.weatherCode ? (WEATHER_CODE_MAP[Number(raw.weatherCode)]?.desc ?? "") : ""),
          iconUrl: raw.iconUrl,
          unit: raw.unit ?? (unit.toLowerCase() === "f" ? "°F" : "°C"),
          precipitation: parseNumber(raw.precipitation),
          precipitationProbability: parseNumber(raw.precipitationProbability),
          hourly: Array.isArray(raw.hourly) ? raw.hourly.map((h: any) => ({
            time: h.time,
            temperature: parseNumber(h.temperature),
            precipitation: parseNumber(h.precipitation),
            precipitationProbability: parseNumber(h.precipitationProbability),
            weatherCode: parseNumber(h.weatherCode),
          })) : undefined,
          rainMessage: raw.rainMessage,
        };

        if (!normalized.rainMessage) {
          normalized.rainMessage = computeRainMessageFromHourly(normalized.hourly);
        }

        setWeather(normalized);
      } catch {
        setWeather({ error: "Failed to fetch weather data" });
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
  }, [params]);

  if (loading) return <div className={className}>Loading weather...</div>;
  if (!weather || weather.error) return <div className={className}>Error: {weather?.error}</div>;

  const getWeatherInsight = () => {
    if (weather.rainMessage && !weather.rainMessage.toLowerCase().includes("no rain")) {
      return weather.rainMessage;
    }

    const desc = (weather.description || "").toLowerCase();
    const tonight = (weather.tonight?.description || "").toLowerCase();
    const tomorrow = (weather.tomorrow?.description || "").toLowerCase();

    if (desc.includes("rain") || tonight.includes("rain") || tomorrow.includes("rain")) {
      return "Rain likely later — keep an umbrella handy.";
    }
    if (desc.includes("sun") || desc.includes("clear")) return "Sunny day ahead";
    if (desc.includes("cloud")) return "Cloudy but stable weather.";
    if (desc.includes("snow")) return "Cold with possible snowfall.";

    const todayTemp = Number(weather.temperature ?? NaN);
    const tomorrowTemp = Number(weather.tomorrow?.temperature ?? NaN);
    if (!isNaN(todayTemp) && !isNaN(tomorrowTemp)) {
      if (tomorrowTemp > todayTemp) return "Warming trend tomorrow.";
      if (tomorrowTemp < todayTemp) return "Cooler weather on the way.";
    }

    return "Mild and stable weather ahead.";
  };


  return (
    <div className={`${className} flex items-center gap-3 p-2`}>
      <div className="text-4xl">{getWeatherIcon(weather?.description ?? "", weather?.iconUrl, weather?.weatherCode)}</div>
      <div className="flex flex-col text-sm leading-tight">
        <div className="font-medium">{weather?.temperature ?? "—"}{weather?.unit} {weather?.description}</div>
        <div className="text-xs text-(--text-secondary)">{getWeatherInsight()}</div>
      </div>
    </div>
  );
}
