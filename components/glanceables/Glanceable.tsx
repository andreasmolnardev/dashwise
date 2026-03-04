import { useConfig } from "@/context/ConfigContext";
import { useLocalization } from "@/context/LocalizationContext";
import { useEffect, useMemo, useState } from "react";
import { getWeatherIcon } from "../widgets/dashboard/Weather";
import { getWeatherAction } from "@/app/actions/integrations";

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

export default function GlanceableComponent({ type, params, className }: GlanceableProps) {
  switch (type) {
    case "date":
      return <GlanceableDate params={params} className={className} />;
    case "greeting":
      return <GlanceableGreeting className={className} />;
    case "local-timezone":
      return <GlanceableLocalTimezone className={className} />; 
    case "weather":
      return <GlanceableWeather params={params} className={className} />;
    case "world-clock":
      return <GlanceableWorldClock params={params} className={className} />;
    default:
      return (
        <div className={`glanceable-default ${className || ""}`}>
          Go to settings to configure
        </div>
      );
  }
}

function GlanceableDate({
  params,
  className,
}: {
  params?: Record<string, any>;
  className?: string;
}) {
  const { formatDate } = useLocalization();
  const formattedDate = formatDate(new Date(), params?.format);

  return <div className={`glanceable-date ${className || ""}`}>{formattedDate}</div>;
}

function GlanceableGreeting({ className }: { className?: string }) {
  return (
    <div className={`glanceable-greeting ${className || ""}`}>
      Hello
    </div>
  );
}

function GlanceableLocalTimezone({ className }: { className?: string }) {
  // Get the user's local timezone abbreviation (like PST, EST)
  const timezoneName = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(part => part.type === 'timeZoneName')?.value || '';

  // Alternatively, get GMT offset like GMT+2
  const offset = -new Date().getTimezoneOffset() / 60;
  const gmtOffset = `GMT${offset >= 0 ? '+' : ''}${offset}`;

  return (
    <div className={`glanceable-local-timezone flex items-center justify-center ${className || ""}`}>
      {timezoneName || gmtOffset}
    </div>
  );
}

function GlanceableWeather({ params, className }: { params?: Record<string, any>, className?: string }) {
  const { config } = useConfig();
  const { weatherUnit } = useLocalization();

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

      // fallback
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
        lon:  Number(match[2])
      };
    }
  }

    if (config.global.weatherLocation) {
      return JSON.parse(
        config.global.weatherLocation.replaceAll("'", '"')
      );
    }

    return null;
  }, [
    params?.locationCoordinates,
    params?.locationDisplayname,
    params?.location,
    config.global.weatherLocation,
  ]);

  const unit = String(params?.unit || weatherUnit || "c").toLowerCase();
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    if (weatherLocation) {
      getWeatherAction({ lat: String(weatherLocation.lat), lon: String(weatherLocation.lon), unit })
        .then((data) => setWeather({ ...data, name: weatherLocation.name }))
        .catch((err) => console.error("Failed to load weather:", err));
    }
  }, [weatherLocation, unit]);

  if (!weather) {
    return <div className={`glanceable-weather ${className || ""}`}>Loading…</div>;
  }

  return (
    <div className={`glanceable-weather flex items-center ${className || ""}`}>
      <span className="mr-2">
        {getWeatherIcon({
          description: weather.description,
          weatherCode: weather.weatherCode,
          size: 22,
          sunrise: weather?.sunrise,
          sunset: weather?.sunset
        })}
      </span>

      <div className="text-wrap text-center">
        {weather.temperature}{weather.unit}
        {params?.showLocation === true ? ` in ${weather.name.split(',')[0]}` : ""}
      </div>
    </div>
  );
}

function GlanceableWorldClock({ params, className }: { params?: Record<string, any>, className?: string }) {
  const { formatTime } = useLocalization();
  const [time, setTime] = useState("");

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      const formatted = formatTime(now, { timeZone: params?.timezone });
      setTime(formatted);
    }

    updateTime();
    const interval = setInterval(updateTime, 60 * 1000);
    return () => clearInterval(interval);
  }, [params?.timezone, formatTime]);

  return (
    <div className={`glanceable-worldclock ${className || ""}`}>
      {time} in {params?.location}
    </div>
  );
}