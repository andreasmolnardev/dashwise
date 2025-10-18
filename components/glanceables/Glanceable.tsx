import { useConfig } from "@/context/ConfigContext";
import { useEffect, useMemo, useState } from "react";
import {
  WiDaySunny,
  WiNightClear,
  WiCloud,
  WiRain,
  WiShowers,
  WiThunderstorm,
  WiSnow,
  WiFog,
} from 'react-icons/wi';

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


function GlanceableDate({ params, className }: { params?: Record<string, any>, className?: string }) {
  const { config } = useConfig();
  const date = new Date();

  const dateFormat =
    params?.format ||
    config?.global?.dateFormat ||
    "DD-MM-YYYY";

  const options: Intl.DateTimeFormatOptions = {
    weekday: dateFormat.includes("ddd") ? "short" : dateFormat.includes("dddd") ? "long" : undefined,
    year: dateFormat.includes("YYYY") ? "numeric" : undefined,
    month: dateFormat.includes("MM") ? "2-digit" : undefined,
    day: dateFormat.includes("DD") ? "2-digit" : undefined,
  };

  const formattedDate = date.toLocaleDateString(config?.global?.locale || "en-US", options);

  const finalDate =
    config?.global?.locale === "de-DE" && dateFormat.includes("ddd")
      ? formattedDate.replace(".,", ",")
      : formattedDate;

  return <div className={`glanceable-date ${className || ""}`}>{finalDate}</div>;
}

function GlanceableGreeting({className}: {className?: string}){
  return (
        <div className={`glanceable-greeting ${className || ""}`}>
          Hello
        </div>
      );
}

function GlanceableWeather({ params, className }: { params?: Record<string, any>, className?: string }) {
  const { config } = useConfig();

  const weatherLocation: WeatherLocation | null = useMemo(() => {
    if (params?.locationDisplayname && params?.locationCoordinates) {
      const coordinates = params.locationCoordinates.replaceAll(" ", "").split(",")
      return {
        name: params.locationDisplayname,
        lat: coordinates[0],
        lon: coordinates[1]
      }
    } else if (config.global.weatherLocation) {
      return JSON.parse(config.global.weatherLocation.replaceAll("'", '"'));
    }

    return null;
  }, [params?.location]);

  const weatherUnit = params?.unit || config?.global?.weatherUnit || "c";
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    if (weatherLocation) {
      fetch(`/api/v1/weather?lat=${weatherLocation.lat}&lon=${weatherLocation.lon}&unit=${weatherUnit}`)
        .then((res) => res.json())
        .then((data) => setWeather({ ...data, name: weatherLocation.name }))
        .catch((err) => console.error("Failed to load weather:", err));
    }
  }, [weatherLocation, weatherUnit]);

  if (!weather) {
    return <div className={`glanceable-weather ${className || ""}`}>Loading…</div>;
  }

  return (
    <div className={`glanceable-weather flex items-center ${className || ""}`}>
      <span className="text-4xl text-yellow-400 mr-2">
        {getWeatherIcon(weather.description, weather.iconCode)}
      </span>
      <div>
        {weather.temperature}{weather.unit}
        {params?.showLocation === true ? ` in ${weather.name}` : ""}
      </div>
    </div>
  );
}


function GlanceableWorldClock({ params, className }: { params?: Record<string, any>, className?: string }) {
  const [time, setTime] = useState("");

    useEffect(() => {
    function updateTime() {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: params?.timezone,
      }).format(now);
      setTime(formatted);
    }

    updateTime();
    const interval = setInterval(updateTime, 60 * 1000);
    return () => clearInterval(interval);
  }, [params?.timezone]);

  return (
    <div className={`glanceable-worldclock ${className || ""}`}>
      {time} in {params?.location}
    </div>
  );
}

function getWeatherIcon(description: string, iconCode?: string) {
  if (!description) return null;
  const desc = description.toLowerCase();

  if (iconCode) {
    if (iconCode === '01d') return <WiDaySunny />;
    if (iconCode === '01n') return <WiNightClear />;
    if (iconCode.startsWith('02')) return <WiCloud />;
    if (iconCode.startsWith('03') || iconCode.startsWith('04')) return <WiCloud />;
    if (iconCode.startsWith('09')) return <WiShowers />;
    if (iconCode.startsWith('10')) return <WiRain />;
    if (iconCode.startsWith('11')) return <WiThunderstorm />;
    if (iconCode.startsWith('13')) return <WiSnow />;
    if (iconCode.startsWith('50')) return <WiFog />;
  }

  if (desc.includes('clear')) return <WiDaySunny />;
  if (desc.includes('cloud')) return <WiCloud />;
  if (desc.includes('rain')) return <WiRain />;
  if (desc.includes('drizzle')) return <WiShowers />;
  if (desc.includes('thunder')) return <WiThunderstorm />;
  if (desc.includes('snow')) return <WiSnow />;
  if (desc.includes('mist') || desc.includes('fog') || desc.includes('haze')) return <WiFog />;

  return <WiCloud />;
}
