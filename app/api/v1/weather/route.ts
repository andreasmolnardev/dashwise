import { NextResponse } from "next/server";

type WeatherCache = {
  timestamp: number;
  data: any;
};

const CACHE: Record<string, WeatherCache> = {};
const SUCCESS_TTL = 30 * 60 * 1000; // 30 min
const ERROR_TTL = 1 * 60 * 1000;    // 1 min

const WEATHER_MAP: Record<number, { desc: string }> = {
  0: { desc: "Clear sky" },
  1: { desc: "Mainly clear" },
  2: { desc: "Partly cloudy" },
  3: { desc: "Overcast" },
  45: { desc: "Fog" },
  51: { desc: "Light drizzle" },
  53: { desc: "Moderate drizzle" },
  55: { desc: "Heavy drizzle" },
  61: { desc: "Rain" },
  63: { desc: "Heavy rain" },
  80: { desc: "Showers" },
};

function getWeatherDescription(code: number) {
  return WEATHER_MAP[code]?.desc ?? `Weather code: ${code}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const unit = searchParams.get("unit") || "c";

  if (!lat || !lon) return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });

  const cacheKey = `${lat},${lon},${unit}`;
  const now = Date.now();

  if (CACHE[cacheKey]) {
    const cached = CACHE[cacheKey].data;
    const ttl = cached.error && cached.status !== 429 ? ERROR_TTL : SUCCESS_TTL;
    if (now - CACHE[cacheKey].timestamp < ttl) return NextResponse.json(cached);
  }

  const temperatureUnit = unit.toLowerCase() === "f" ? "fahrenheit" : "celsius";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode,precipitation,precipitation_probability,windspeed_10m,winddirection_10m&daily=sunrise,sunset&temperature_unit=${temperatureUnit}&precipitation_unit=mm`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = { error: `Upstream error ${response.status}`, status: response.status };
      if (response.status !== 429) CACHE[cacheKey] = { timestamp: now, data: errorData };
      return NextResponse.json(errorData, { status: response.status });
    }

    const data = await response.json();
    const current = data.current_weather;

    // Determine if it is raining now
    const rainingNowCode = [51, 53, 55, 61, 63, 80].includes(current.weathercode);

    const hourlyTimes: string[] = data.hourly.time || [];
    const hourlyPrecip: number[] = data.hourly.precipitation || [];
    const hourlyPrecipProb: number[] = data.hourly.precipitation_probability || [];

    const nowDate = new Date();
    const nowTime = nowDate.getTime();

    let rainingNow = rainingNowCode; // start with weathercode
    let rainMessage = "No rain expected";

    // check hourly precipitation
    for (let i = 0; i < hourlyPrecip.length; i++) {
      const rainDate = new Date(hourlyTimes[i]);
      if (hourlyPrecip[i] > 0) {
        if (rainDate.getTime() > nowTime) {
          const hours = rainDate.getHours().toString().padStart(2, "0");
          const minutes = rainDate.getMinutes().toString().padStart(2, "0");
          rainMessage = `Rain starts at ${hours}:${minutes}`;
        }
        break;
      }
    }

    const temperature = current?.temperature;
    const weatherCode = current?.weathercode;
    const description = getWeatherDescription(weatherCode);

    const findForecast = (hour: number) => {
      const idx = hourlyTimes.findIndex(t => new Date(t).getHours() === hour);
      if (idx === -1) return null;
      return {
        temperature: hourlyTemps[idx],
        weatherCode: hourlyCodes[idx],
        description: getWeatherDescription(hourlyCodes[idx]),
        precipitation: hourlyPrecip[idx],
        precipitationProbability: hourlyPrecipProb[idx],
      };
    };

    const hourlyTemps: number[] = data.hourly.temperature_2m || [];
    const hourlyCodes: number[] = data.hourly.weathercode || [];

    const tonight = findForecast(21); // 21:00 today
    const tomorrow = findForecast(12); // 12:00 tomorrow

    const nowHour = nowDate.getHours();

    const result = {
      temperature: temperature !== undefined ? Math.round(temperature) : undefined,
      weatherCode,
      description,
      unit: unit.toUpperCase() === "F" ? "°F" : "°C",
      windSpeed: current?.windspeed !== undefined ? Math.round(current.windspeed) : undefined,
      windDirection: current?.winddirection !== undefined ? Math.round(current.winddirection) : undefined,
      precipitation: hourlyPrecip[nowHour] !== undefined ? Math.round(hourlyPrecip[nowHour]) : undefined,
      precipitationProbability: hourlyPrecipProb[nowHour] !== undefined ? Math.round(hourlyPrecipProb[nowHour]) : undefined,
      rainingNow,
      rainMessage,
      tonight: tonight
        ? {
            ...tonight,
            temperature: tonight.temperature !== undefined ? Math.round(tonight.temperature) : undefined,
            precipitation: tonight.precipitation !== undefined ? Math.round(tonight.precipitation) : undefined,
            precipitationProbability:
              tonight.precipitationProbability !== undefined ? Math.round(tonight.precipitationProbability) : undefined,
          }
        : null,
      tomorrow: tomorrow
        ? {
            ...tomorrow,
            temperature: tomorrow.temperature !== undefined ? Math.round(tomorrow.temperature) : undefined,
            precipitation: tomorrow.precipitation !== undefined ? Math.round(tomorrow.precipitation) : undefined,
            precipitationProbability:
              tomorrow.precipitationProbability !== undefined ? Math.round(tomorrow.precipitationProbability) : undefined,
          }
        : null,
      sunrise: data.daily?.sunrise?.[0],
      sunset: data.daily?.sunset?.[0],
    };

    CACHE[cacheKey] = { timestamp: now, data: result };
    return NextResponse.json(result);
  } catch (err) {
    const errorData = { error: "Internal error", status: 500 };
    CACHE[cacheKey] = { timestamp: now, data: errorData };
    return NextResponse.json(errorData, { status: 500 });
  }
}
