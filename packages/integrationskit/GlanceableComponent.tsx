import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

export type GlanceableProps = {
  type: string;
  params?: Record<string, any>;
  className?: string;
};

type WeatherLocation = {
  lat: string;
  lon: string;
  name: string;
};

type GlanceableRendererProps = GlanceableProps;

const GLANCEABLE_RENDERERS: Record<string, (props: GlanceableRendererProps) => ReactElement> = {
  date: GlanceableDate,
  greeting: GlanceableGreeting,
  "local-timezone": GlanceableLocalTimezone,
  weather: GlanceableWeather,
  "world-clock": GlanceableWorldClock,
};

export default function GlanceableComponent({ type, params, className }: GlanceableProps) {
  const Renderer = GLANCEABLE_RENDERERS[type];

  if (Renderer) {
    return <Renderer params={params} className={className} type={type} />;
  }

  return (
    <div className={`glanceable-default ${className || ""}`}>
      Go to settings to configure
    </div>
  );
}

function parseTemplateLikeString(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;

  const text = String(raw).trim();
  if (!text) return undefined;

  const segments = text.includes("???") ? text.split("???") : [text];
  for (const segment of segments) {
    const candidate = segment.trim();
    if (!candidate || /^type:/i.test(candidate)) continue;
    return candidate.replace(/^['\"]|['\"]$/g, "").trim();
  }

  return undefined;
}

function normalizeTimezone(raw: unknown): string | undefined {
  const parsed = parseTemplateLikeString(raw);
  if (!parsed) return undefined;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

function GlanceableDate({
  params,
  className,
}: GlanceableRendererProps) {
  const formattedDate = formatDate(new Date(), params?.format);

  return <div className={`glanceable-date ${className || ""}`}>{formattedDate}</div>;
}

function GlanceableGreeting({ className }: GlanceableRendererProps) {
  return (
    <div className={`glanceable-greeting ${className || ""}`}>
      Hello
    </div>
  );
}

function GlanceableLocalTimezone({ className }: GlanceableRendererProps) {
  const timezoneName = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(part => part.type === 'timeZoneName')?.value || '';

  const offset = -new Date().getTimezoneOffset() / 60;
  const gmtOffset = `GMT${offset >= 0 ? '+' : ''}${offset}`;

  return (
    <div className={`glanceable-local-timezone flex items-center justify-center ${className || ""}`}>
      {timezoneName || gmtOffset}
    </div>
  );
}

//TODO: Build from Glanceable in yaml
function GlanceableWeather({ params, className }: GlanceableRendererProps) {
  const preloadedWeather = params?.data;

  const weatherLocation: WeatherLocation | null = useMemo(() => {
    if (params?.locationDisplayname && params?.locationCoordinates) {
      let coordinates: { lat: number; lon: number } | null = null;

      if (typeof params.locationCoordinates === "string") {
        const match = params.locationCoordinates.match(
          /^\s*\{\s*'lat'\s*:\s*'([^']+)'\s*,\s*'lon'\s*:\s*'([^']+)'\s*(?:,\s*'name'\s*:\s*'([^']+)')?\s*\}\s*$/
        );

        if (match) {
          coordinates = {
            lat: Number(match[1]),
            lon: Number(match[2]),
          };
        }
      }

      if (!coordinates && Array.isArray(params.location)) {
        coordinates = {
          lat: Number(params.location[0]),
          lon: Number(params.location[1]),
        };
      }

      if (!coordinates) return null;

      return {
        name: params.locationDisplayname,
        lat: coordinates.lat,
        lon: coordinates.lon,
      };
    }

    if (typeof params?.location?.coordinates === "string") {
      const match = params.location.coordinates.match(
        /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
      );

      if (match) {
        return {
          name: params.location.displayName,
          lat: Number(match[1]),
          lon: Number(match[2])
        };
      }
    }

    return null;
  }, [
    params?.locationCoordinates,
    params?.locationDisplayname,
    params?.location,
  ]);
  const [weather, setWeather] = useState<any>(preloadedWeather ?? null);

  useEffect(() => {
    if (preloadedWeather) {
      setWeather(preloadedWeather);
    }
  }, [preloadedWeather]);

  
  if (!weather) {
    return <div className={`glanceable-weather ${className || ""}`}>Loading…</div>;
  }

  return (
    <div className={`glanceable-weather flex items-center ${className || ""}`}>
      <span className="mr-2">
        <span aria-hidden="true">{getWeatherEmoji(weather.weatherCode, weather.description)}</span>
      </span>

      <div className="text-wrap text-center">
        {weather.temperature}{weather.unit}
        {params?.showLocation === true ? ` in ${weather.name.split(',')[0]}` : ""}
      </div>
    </div>
  );
}

function getWeatherEmoji(weatherCode: unknown, description: unknown) {
  const code = typeof weatherCode === "number" ? weatherCode : Number(weatherCode);
  if (Number.isFinite(code)) {
    if (code === 0) return "☀️";
    if (code === 1 || code === 2) return "🌤️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code === 51 || code === 53 || code === 55) return "🌦️";
    if (code === 56 || code === 57) return "🌧️";
    if (code === 61 || code === 63 || code === 65) return "🌧️";
    if (code === 66 || code === 67) return "🌨️";
    if (code === 71 || code === 73 || code === 75) return "❄️";
    if (code === 80 || code === 81 || code === 82) return "🌧️";
    if (code === 95 || code === 96 || code === 99) return "⛈️";
  }

  const text = typeof description === "string" ? description.toLowerCase() : "";
  if (text.includes("snow")) return "❄️";
  if (text.includes("thunder")) return "⛈️";
  if (text.includes("fog")) return "🌫️";
  if (text.includes("rain") || text.includes("drizzle")) return "🌧️";
  if (text.includes("cloud")) return "☁️";
  if (text.includes("sun") || text.includes("clear")) return "☀️";
  return "🌡️";
}

function getWeatherDescription(weatherCode: unknown) {
  const code = typeof weatherCode === "number" ? weatherCode : Number(weatherCode);

  if (!Number.isFinite(code)) {
    return "Weather";
  }

  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 73 || code === 75) return "Snow";
  if (code === 80 || code === 81 || code === 82) return "Showers";
  if (code === 95 || code === 96 || code === 99) return "Thunderstorm";

  return "Weather";
}

function GlanceableWorldClock({ params, className }: GlanceableRendererProps) {
  const [time, setTime] = useState("");
  const timezone = useMemo(() => normalizeTimezone(params?.timezone), [params?.timezone]);
  const location = useMemo(() => parseTemplateLikeString(params?.location) || "", [params?.location]);

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      const formatted = timezone ? formatTime(now, { timeZone: timezone }) : formatTime(now);
      setTime(formatted);
    }

    updateTime();
    const interval = setInterval(updateTime, 60 * 1000);
    return () => clearInterval(interval);
  }, [timezone, formatTime]);

  return (
    <div className={`glanceable-worldclock ${className || ""}`}>
      {time}{location ? ` in ${location}` : ""}
    </div>
  );
}

function formatDate(input?: Date | string | number, overrideFormat?: string) {
  const date = toDate(input);
  const pattern = overrideFormat || "DD-MM-YYYY";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);

  return pattern
    .replace("dddd", weekdayLong)
    .replace("ddd", weekdayShort)
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", year)
    .trim();
}

function formatTime(input?: Date | string | number, opts?: Intl.DateTimeFormatOptions) {
  const date = toDate(input);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

function toDate(input?: Date | string | number): Date {
  if (!input) return new Date();
  return input instanceof Date ? input : new Date(input);
}
