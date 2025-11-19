import React, { useEffect, useState } from "react";
import type { WidgetItemProps } from "../Widget";
import { useConfig } from "@/context/ConfigContext";

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
  sunrise?: string;
  sunset?: string;
  error?: string;
}

const WEATHER_CODE_MAP: Record<number, { file: string; desc: string }> = {
  0: { file: "sun-clear.svg", desc: "Clear sky" },
  1: { file: "sun-clear.svg", desc: "Mainly clear" },
  2: { file: "cloudy-sun.svg", desc: "Partly cloudy" },
  3: { file: "clouds-overcast.svg", desc: "Overcast" },
  45: { file: "cloud-fog.svg", desc: "Fog" },
  48: { file: "cloud-fog.svg", desc: "Rime fog" },
  51: { file: "cloud-drizzle.svg", desc: "Light drizzle" },
  53: { file: "cloud-drizzle.svg", desc: "Moderate drizzle" },
  55: { file: "cloud-rain-heavy.svg", desc: "Dense drizzle" },
  56: { file: "glass-sleet-96.png", desc: "Freezing drizzle" }, // fallback, no svg
  57: { file: "cloud-sleet.svg", desc: "Freezing drizzle (heavy)" },
  61: { file: "cloud-rain.svg", desc: "Slight rain" },
  63: { file: "cloud-rain.svg", desc: "Moderate rain" },
  65: { file: "glass-rain-cloud-96.png", desc: "Heavy rain" }, // fallback, no svg
  66: { file: "cloud-sleet.svg", desc: "Freezing rain" },
  67: { file: "cloud-sleet.svg", desc: "Freezing rain (heavy)" },
  71: { file: "cloud-snow.svg", desc: "Slight snow" },
  73: { file: "cloud-snow.svg", desc: "Moderate snow" },
  75: { file: "cloud-snow.svg", desc: "Heavy snow" },
  80: { file: "cloud-rain.svg", desc: "Slight showers" },
  81: { file: "cloud-rain.svg", desc: "Moderate showers" },
  82: { file: "cloud-rain-heavy.svg", desc: "Violent showers" },
  95: { file: "thunderstorm.svg", desc: "Thunderstorm" },
  96: { file: "thunderstorm.svg", desc: "Thunderstorm with slight hail" },
  99: { file: "thunderstorm.svg", desc: "Thunderstorm with heavy hail" },
};


function isNight(sunrise?: string, sunset?: string) {
  if (!sunrise || !sunset) return false;
  const now = new Date();
  return now < new Date(sunrise) || now > new Date(sunset);
}

export function getWeatherIcon({ description = "", iconUrl, weatherCode, size = 48, sunrise, sunset, nightVersion,
}: {
  description?: string;
  iconUrl?: string;
  weatherCode?: number;
  size?: number;
  sunrise?: string;
  sunset?: string;
  nightVersion?: boolean;
}) {
  const night = isNight(sunrise, sunset);
  let file = WEATHER_CODE_MAP[weatherCode ?? 0]?.file || "clouds-100.svg";

  if (night === true || nightVersion === true) {
    if (file.includes("sun-clear")) file = "moon-stars-night.svg";
    if (file.includes("cloudy-sun")) file = "clouds-100.svg";
  }

  if (file == "moon-stars-night.svg") {
    size = 0.8 * size;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        maskImage: `url(/weather-icons/${file})`,
        WebkitMaskImage: `url(/weather-icons/${file})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
      className="
          relative
          bg-white/25
          backdrop-blur-md
          transition
          group-hover:bg-(--primary)
        "
      aria-label={description}
    >
      {/* glass gradient overlay */}
      <div
        className="
            pointer-events-none
            absolute inset-0
            bg-gradient-to-br
            from-white/50
            to-transparent
            mix-blend-overlay
          "
      />
    </div>
  );
}

const parseNumber = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export default function WeatherWidget({ className = "", params }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  const { config, refreshConfig } = useConfig();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchWeather({ params, config });
      setWeather(data);
      setLoading(false);
    };
    load();
  }, [params, config]);


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
      <div className="grid grid-cols-3 grid-rows-[1rem 1fr 1rem] gap-2 w-full my-1">
        {columns.map(
          (col, idx) =>
            col.data && (
              <div key={idx} className="grid grid-cols-subgrid gap-1.5 text-xs items-center justify-items-center">
                <strong className="text-sm">{col.label}</strong>
                <div className="text-xl my-1">
                  {getWeatherIcon({
                    description: idx === 0 ? weather.description : col.data.description,
                    iconUrl: idx === 0 ? weather.iconUrl : col.data.iconUrl,
                    weatherCode: idx === 0 ? weather.weatherCode : (col.data as any).weatherCode,
                    size: 32,
                    sunrise: weather.sunrise,
                    sunset: weather.sunset,
                    nightVersion: idx === 1
                  })}
                </div>
                <div>
                  {col.data.temperature ?? "—"}
                  {weather.unit} - {col.data.precipitationProbability ?? 0}%
                </div>
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

  const { config, refreshConfig } = useConfig();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchWeather({ params, config });
      setWeather(data);
      setLoading(false);
    };
    load();
  }, [params, config]);


  if (loading) return <div className={className}>Loading weather...</div>;
  if (!weather || weather.error) return <div className={className}>Error: {weather?.error}</div>;

  const getWeatherInsight = () => {
    if (weather.rainMessage && !weather.rainMessage.toLowerCase().includes("no rain")) {
      return weather.rainMessage;
    }

    const desc = (weather.description || "").toLowerCase();

    if (desc.includes("rain")) return "Rain likely later — keep an umbrella handy.";
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
      <div className="text-4xl">
        {getWeatherIcon({
          description: weather?.description,
          iconUrl: weather?.iconUrl,
          weatherCode: weather?.weatherCode,
          size: 48,
          sunrise: weather?.sunrise,
          sunset: weather?.sunset
        })}
      </div>
      <div className="flex flex-col text-sm leading-tight">
        <div className="font-medium">
          {weather?.temperature ?? "—"}{weather?.unit} {weather?.description}
        </div>
        <div className="text-xs text-(--text-secondary)">
          {getWeatherInsight()}
        </div>
      </div>
    </div>
  );
}

async function fetchWeather({
  params,
  config,
}: {
  params?: WeatherWidgetParams;
  config: any;
}): Promise<WeatherData> {
  let lat: string | undefined;
  let lon: string | undefined;

  if (params?.locationCoordinates) {
    const coords = params.locationCoordinates
      .split(",")
      .map((s) => s.trim());

    lat = coords[0];
    lon = coords[1];
  }

  if ((!lat || !lon) && config?.global?.weatherLocation) {
    const fallback = JSON.parse(config.global.weatherLocation.replaceAll("'", '"'));
    lat = fallback.lat;
    lon = fallback.lon;
  }

  const unit = params?.unit || "c";

  if (!lat || !lon) {
    return { error: "Missing lat/lon" };
  }

  const res = await fetch(
    `/api/v1/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
      lon
    )}&unit=${encodeURIComponent(unit)}`
  );

  const raw = await res.json();

  if (!res.ok) {
    return { error: raw?.error ?? `Upstream error ${res.status}` };
  }

  const normalized: WeatherData = {
    temperature: parseNumber(raw.temperature),
    weatherCode: parseNumber(raw.weatherCode),
    description:
      raw.description ??
      (raw.weatherCode ? WEATHER_CODE_MAP[Number(raw.weatherCode)]?.desc ?? "" : ""),
    iconUrl: raw.iconUrl,
    unit: raw.unit ?? (unit.toLowerCase() === "f" ? "°F" : "°C"),
    windSpeed: parseNumber(raw.windSpeed),
    windDirection: parseNumber(raw.windDirection),
    humidity: parseNumber(raw.humidity),
    precipitation: parseNumber(raw.precipitation),
    precipitationProbability: parseNumber(raw.precipitationProbability),
    sunrise: raw.sunrise,
    sunset: raw.sunset,
    tonight: raw.tonight
      ? {
        temperature: parseNumber(raw.tonight.temperature),
        description:
          raw.tonight.description ??
          (raw.tonight.weatherCode
            ? WEATHER_CODE_MAP[Number(raw.tonight.weatherCode)]?.desc
            : undefined),
        iconUrl: raw.tonight.iconUrl,
        precipitation: parseNumber(raw.tonight.precipitation),
        precipitationProbability: parseNumber(raw.tonight.precipitationProbability),
      }
      : undefined,
    tomorrow: raw.tomorrow
      ? {
        temperature: parseNumber(raw.tomorrow.temperature),
        description:
          raw.tomorrow.description ??
          (raw.tomorrow.weatherCode
            ? WEATHER_CODE_MAP[Number(raw.tomorrow.weatherCode)]?.desc
            : undefined),
        iconUrl: raw.tomorrow.iconUrl,
        precipitation: parseNumber(raw.tomorrow.precipitation),
        precipitationProbability: parseNumber(raw.tomorrow.precipitationProbability),
      }
      : undefined,
    hourly: Array.isArray(raw.hourly)
      ? raw.hourly.map((h: any) => ({
        time: h.time,
        temperature: parseNumber(h.temperature),
        precipitation: parseNumber(h.precipitation),
        precipitationProbability: parseNumber(h.precipitationProbability),
        weatherCode: parseNumber(h.weatherCode),
      }))
      : undefined,
    rainMessage: raw.rainMessage,
  };

  return normalized;
}
