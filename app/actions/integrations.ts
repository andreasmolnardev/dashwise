"use server";

import { ActionAuth, requireUserAuth } from "@/dashwise-sdk/data/auth";
import {
  createIntegration,
  getIntegration,
  getWidgetProperties,
  listIntegrations,
  testIntegrationEndpoint,
} from "@/dashwise-sdk/data/integrations";

const WEATHER_DESC: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle (heavy)",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain (heavy)",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight showers",
  81: "Moderate showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function num(v: unknown) {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function getIntegrationsAction(
  auth: ActionAuth,
  options?: { id?: string; resolveEndpoints?: boolean }
) {
  const { userId } = await requireUserAuth(auth);

  if (options?.id) {
    return getIntegration(userId, options.id, !!options.resolveEndpoints);
  }

  return listIntegrations(userId);
}

export async function createIntegrationAction(
  auth: ActionAuth,
  payload: { name?: string; source?: string; config: unknown; environment?: unknown }
) {
  const { userId } = await requireUserAuth(auth);
  return createIntegration(userId, payload);
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  const { userId } = await requireUserAuth(auth);
  try {
    return await testIntegrationEndpoint(userId, target);
  } catch (error) {
    console.error("[Integrations Action] testIntegrationEndpointAction failed", {
      target,
      error,
    });
    throw error;
  }
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  const { userId } = await requireUserAuth(auth);
  console.log(`[Integrations Action] Fetching widget properties for slug: ${widgetSlug}`);
  return getWidgetProperties(userId, widgetSlug);
}

export async function getWeatherAction({ lat, lon, unit = "c" }: { lat: string; lon: string; unit?: string }) {
  if (!lat || !lon) {
    throw new Error("Missing lat/lon");
  }

  const useFahrenheit = String(unit).toLowerCase() === "f";

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "relative_humidity_2m",
      "precipitation",
    ].join(","),
    hourly: [
      "temperature_2m",
      "precipitation",
      "precipitation_probability",
      "weather_code",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
    ].join(","),
    forecast_days: "3",
    timezone: "auto",
    temperature_unit: useFahrenheit ? "fahrenheit" : "celsius",
    wind_speed_unit: useFahrenheit ? "mph" : "kmh",
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    next: { revalidate: 600 },
  });

  if (!response.ok) {
    throw new Error(`Weather upstream failed: ${response.status}`);
  }

  const json = await response.json();
  const current = json?.current ?? {};
  const daily = json?.daily ?? {};
  const hourly = json?.hourly ?? {};

  const description = WEATHER_DESC[num(current.weather_code) ?? -1] ?? "Unknown";

  const hourlyData = Array.isArray(hourly?.time)
    ? hourly.time.slice(0, 12).map((time: string, index: number) => ({
        time,
        temperature: num(hourly.temperature_2m?.[index]),
        precipitation: num(hourly.precipitation?.[index]),
        precipitationProbability: num(hourly.precipitation_probability?.[index]),
        weatherCode: num(hourly.weather_code?.[index]),
      }))
    : [];

  const todayRainChance = num(daily.precipitation_probability_max?.[0]) ?? 0;
  const rainMessage =
    todayRainChance >= 60
      ? "Rain likely today"
      : todayRainChance >= 30
        ? "Possible rain later today"
        : "No rain expected";

  return {
    temperature: num(current.temperature_2m),
    weatherCode: num(current.weather_code),
    description,
    unit: useFahrenheit ? "°F" : "°C",
    windSpeed: num(current.wind_speed_10m),
    windDirection: num(current.wind_direction_10m),
    humidity: num(current.relative_humidity_2m),
    precipitation: num(current.precipitation),
    precipitationProbability: num(daily.precipitation_probability_max?.[0]),
    sunrise: daily.sunrise?.[0],
    sunset: daily.sunset?.[0],
    tonight: {
      temperature: num(daily.temperature_2m_min?.[0]),
      weatherCode: num(daily.weather_code?.[0]),
      description: WEATHER_DESC[num(daily.weather_code?.[0]) ?? -1] ?? "Unknown",
      precipitation: num(daily.precipitation_sum?.[0]),
      precipitationProbability: num(daily.precipitation_probability_max?.[0]),
    },
    tomorrow: {
      temperature: num(daily.temperature_2m_max?.[1]),
      weatherCode: num(daily.weather_code?.[1]),
      description: WEATHER_DESC[num(daily.weather_code?.[1]) ?? -1] ?? "Unknown",
      precipitation: num(daily.precipitation_sum?.[1]),
      precipitationProbability: num(daily.precipitation_probability_max?.[1]),
    },
    hourly: hourlyData,
    rainMessage,
  };
}
