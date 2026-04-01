"use server";

import { getWeather as getWeatherData } from "@dashwise/sdk/data/weather";

type GetWeatherInput = {
  lat: string;
  lon: string;
  unit?: string;
};

export async function getWeather({ lat, lon, unit = "c" }: GetWeatherInput) {
  if (!lat || !lon) {
    throw new Error("Missing lat/lon");
  }

  return getWeatherData({ lat: String(lat), lon: String(lon), unit });
}
