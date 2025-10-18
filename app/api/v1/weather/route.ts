// app/api/weather/route.ts
import { NextResponse } from "next/server";

type WeatherCache = {
  timestamp: number;
  data: any;
};

const CACHE: Record<string, WeatherCache> = {};
const SUCCESS_TTL = 30 * 60 * 1000; // 30 min
const ERROR_TTL = 1 * 60 * 1000;    // 1 min for other errors (not 429)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const unit = searchParams.get("unit") || "c";

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const cacheKey = `${lat},${lon},${unit}`;
  const now = Date.now();

  // Serve cached data if still valid (ignore cached 429)
  if (CACHE[cacheKey]) {
    const cached = CACHE[cacheKey].data;
    const ttl = cached.error && cached.status !== 429 ? ERROR_TTL : SUCCESS_TTL;
    if (now - CACHE[cacheKey].timestamp < ttl) {
      return NextResponse.json(cached);
    }
  }

  const wttrUnit = unit.toLowerCase() === "f" ? "F" : "C";
  const url = `https://wttr.in/${lat},${lon}?format=j1`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = { error: `Upstream error ${response.status}`, status: response.status };
      if (response.status !== 429) {
        CACHE[cacheKey] = { timestamp: now, data: errorData };
      }
      return NextResponse.json(errorData, { status: response.status });
    }

    const data = await response.json();
    const current = data.current_condition?.[0];

    const description = current?.weatherDesc?.[0]?.value ?? '';
    const iconUrl = current?.weatherIconUrl?.[0]?.value ?? '';

    const result = {
      temperature: wttrUnit === 'F' ? current?.temp_F : current?.temp_C,
      weatherCode: current?.weatherCode ?? null,
      description,
      iconUrl,
      unit: wttrUnit === 'F' ? '°F' : '°C',
    };

    CACHE[cacheKey] = { timestamp: now, data: result };
    return NextResponse.json(result);

  } catch (err) {
    const errorData = { error: "Internal error", status: 500 };
    CACHE[cacheKey] = { timestamp: now, data: errorData };
    return NextResponse.json(errorData, { status: 500 });
  }
}
