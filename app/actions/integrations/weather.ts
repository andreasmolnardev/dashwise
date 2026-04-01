"use server";

import { getComputedPropertyData } from "@dashwise/sdk/data/weather";

type GetWeatherInput = {
  lat: string;
  lon: string;
  unit?: string;
};

export async function getWeather({ lat, lon, unit = "c" }: GetWeatherInput) {
  if (!lat || !lon) {
    throw new Error("Missing lat/lon");
  }

  return getComputedPropertyData({
    source: "computed.weather",
    input: { lat: String(lat), lon: String(lon), unit },
  });
}
