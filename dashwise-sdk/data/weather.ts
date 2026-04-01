import { readFile } from "fs/promises";
import path from "path";
import YAML from "yaml";

type ComputedPropertyInput = {
    source: string;
    input?: Record<string, any>;
};

type WeatherData = {
    temperature?: number;
    weatherCode?: number;
    description?: string;
    unit?: string;
    windSpeed?: number;
    windDirection?: number;
    humidity?: number;
    precipitation?: number;
    precipitationProbability?: number;
    sunrise?: string;
    sunset?: string;
    iconFile?: string;
    rainMessage?: string;
    insight?: string;
    tonight?: {
        temperature?: number;
        weatherCode?: number;
        description?: string;
        precipitation?: number;
        precipitationProbability?: number;
        iconFile?: string;
    };
    tomorrow?: {
        temperature?: number;
        weatherCode?: number;
        description?: string;
        precipitation?: number;
        precipitationProbability?: number;
        iconFile?: string;
    };
    hourly?: Array<{
        time: string;
        temperature?: number;
        precipitation?: number;
        precipitationProbability?: number;
        weatherCode?: number;
    }>;
};

type WeatherIntegrationDefinition = {
    configuration?: {
        lookup_tables?: Record<string, any>;
    };
};

/**
 * Loads and parses integration YAML from the current working directory,
 * falling back to one level up for server/runtime path differences.
 */
async function loadIntegrationYaml(relativePath: string) {
    const candidatePaths = [
        path.resolve(process.cwd(), relativePath),
        path.resolve(process.cwd(), `../${relativePath}`),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const content = await readFile(candidatePath, "utf-8");
            return YAML.parse(content) as Record<string, any>;
        } catch {
            continue;
        }
    }

    return null;
}

function num(v: unknown) {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function getWeatherLookup(definition: WeatherIntegrationDefinition | null, code?: number) {
    const tables = definition?.configuration?.lookup_tables ?? {};
    const weatherCodeMap = tables.weather_code_map ?? {};
    const entry = weatherCodeMap?.[String(code ?? -1)] ?? weatherCodeMap?.[code as any] ?? {};

    return {
        file: typeof entry.file === "string" ? entry.file : undefined,
        desc: typeof entry.desc === "string" ? entry.desc : "Unknown",
    };
}

function resolveWeatherIconFile(
    definition: WeatherIntegrationDefinition | null,
    weatherCode?: number,
    sunrise?: string,
    sunset?: string,
    options?: { forceNight?: boolean },
) {
    const lookup = getWeatherLookup(definition, weatherCode);
    let file = lookup.file ?? "clouds-100.svg";

    const isNight = options?.forceNight
        || (sunrise && sunset
            ? new Date() < new Date(sunrise) || new Date() > new Date(sunset)
            : false);

    if (isNight) {
        if (file.includes("sun-clear")) file = "moon-stars-night.svg";
        if (file.includes("cloudy-sun")) file = "cloud.svg";
    }

    return file;
}

function buildWeatherInsight(weather: { description?: string; temperature?: number }, tomorrowTemp?: number) {
    const desc = (weather.description || "").toLowerCase();

    if (desc.includes("rain")) return "Rain likely later — keep an umbrella handy.";
    if (desc.includes("sun") || desc.includes("clear")) return "Sunny day ahead";
    if (desc.includes("cloud")) return "Cloudy but stable weather.";
    if (desc.includes("snow")) return "Cold with possible snowfall.";
    if (typeof weather.temperature === "number" && typeof tomorrowTemp === "number") {
        if (tomorrowTemp > weather.temperature) return "Warming trend tomorrow.";
        if (tomorrowTemp < weather.temperature) return "Cooler weather on the way.";
    }
    return "Mild and stable weather ahead.";
}

async function loadWeatherDefinition() {
    return (await loadIntegrationYaml("lib/integrations/weather.yaml")) as WeatherIntegrationDefinition | null;
}

async function resolveComputedWeatherData({
    lat,
    lon,
    unit = "c",
}: {
    lat: string;
    lon: string;
    unit?: string;
}): Promise<WeatherData> {
    const definition = await loadWeatherDefinition();
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

    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
        { next: { revalidate: 600 } },
    );

    if (!response.ok) {
        throw new Error(`Weather upstream failed: ${response.status}`);
    }

    const json = await response.json();
    const current = json?.current ?? {};
    const daily = json?.daily ?? {};
    const hourly = json?.hourly ?? {};

    const currentCode = num(current.weather_code);
    const tonightCode = num(daily.weather_code?.[0]);
    const tomorrowCode = num(daily.weather_code?.[1]);
    const sunrise = daily.sunrise?.[0];
    const sunset = daily.sunset?.[0];

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

    const currentLookup = getWeatherLookup(definition, currentCode);
    const tonightLookup = getWeatherLookup(definition, tonightCode);
    const tomorrowLookup = getWeatherLookup(definition, tomorrowCode);

    return {
        temperature: num(current.temperature_2m),
        weatherCode: currentCode,
        description: currentLookup.desc,
        unit: useFahrenheit ? "°F" : "°C",
        windSpeed: num(current.wind_speed_10m),
        windDirection: num(current.wind_direction_10m),
        humidity: num(current.relative_humidity_2m),
        precipitation: num(current.precipitation),
        precipitationProbability: num(daily.precipitation_probability_max?.[0]),
        sunrise,
        sunset,
        iconFile: resolveWeatherIconFile(definition, currentCode, sunrise, sunset),
        tonight: {
            temperature: num(daily.temperature_2m_min?.[0]),
            weatherCode: tonightCode,
            description: tonightLookup.desc,
            precipitation: num(daily.precipitation_sum?.[0]),
            precipitationProbability: num(daily.precipitation_probability_max?.[0]),
            iconFile: resolveWeatherIconFile(definition, tonightCode, sunrise, sunset, { forceNight: true }),
        },
        tomorrow: {
            temperature: num(daily.temperature_2m_max?.[1]),
            weatherCode: tomorrowCode,
            description: tomorrowLookup.desc,
            precipitation: num(daily.precipitation_sum?.[1]),
            precipitationProbability: num(daily.precipitation_probability_max?.[1]),
            iconFile: resolveWeatherIconFile(definition, tomorrowCode, sunrise, sunset),
        },
        hourly: hourlyData,
        rainMessage,
        insight: buildWeatherInsight(
            { description: currentLookup.desc, temperature: num(current.temperature_2m) },
            num(daily.temperature_2m_max?.[1]),
        ),
    };
}

export async function getComputedPropertyData({
    source,
    input,
}: ComputedPropertyInput): Promise<Record<string, any> | null> {
    if (String(source || "").trim().toLowerCase() !== "computed.weather") {
        return null;
    }

    const payload = input && typeof input === "object" ? input : {};
    const lat = payload.lat ?? payload.latitude;
    const lon = payload.lon ?? payload.longitude;
    if (lat === undefined || lon === undefined || lat === null || lon === null) {
        return null;
    }

    return resolveComputedWeatherData({
        lat: String(lat),
        lon: String(lon),
        unit: payload.unit ? String(payload.unit) : "c",
    });
}
