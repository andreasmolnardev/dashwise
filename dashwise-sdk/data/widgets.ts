import { getHomeLinks } from "./links";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { readFile } from "fs/promises";
import path from "path";
import YAML from "yaml";

type WidgetPreviewData = {
    template?: string;
    properties?: Record<string, any>;
};

type WidgetCatalogItem = {
    slug: string;
    name?: string;
    description?: string;
    template?: string;
    properties?: Record<string, any>;
    data?: {
        source?: string;
        input?: Record<string, any>;
    };
    exampleProps?: Record<string, any>;
    preview?: WidgetPreviewData;
};

type WidgetCatalog = Record<string, WidgetCatalogItem[]>;

function normalizeWidgetSlug(value: string) {
    return value
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

function normalizeWidgetList(rawWidgets: unknown): WidgetCatalogItem[] {
    if (!Array.isArray(rawWidgets)) return [];

    return rawWidgets
        .filter((entry): entry is Record<string, any> => !!entry && typeof entry === "object")
        .map((widget) => {
            const label =
                typeof widget.name === "string" && widget.name.trim()
                    ? widget.name.trim()
                    : "Integration Widget";
            const explicitSlug = typeof widget.slug === "string" ? widget.slug.trim() : "";
            const slug = explicitSlug || normalizeWidgetSlug(label);

            const data = widget.data && typeof widget.data === "object"
                ? {
                    source:
                        typeof widget.data.source === "string" && widget.data.source.trim()
                            ? widget.data.source.trim()
                            : undefined,
                    input:
                        widget.data.input && typeof widget.data.input === "object"
                            ? (widget.data.input as Record<string, any>)
                            : {},
                }
                : undefined;

            return {
                slug,
                name: label,
                description:
                    typeof widget.description === "string" ? widget.description : undefined,
                template:
                    typeof widget.template === "string" ? widget.template : "columns",
                properties:
                    widget.properties && typeof widget.properties === "object"
                        ? (widget.properties as Record<string, any>)
                        : {},
                data,
                preview:
                    widget.preview && typeof widget.preview === "object"
                        ? {
                            template:
                                typeof widget.preview.template === "string"
                                    ? widget.preview.template
                                    : undefined,
                            properties:
                                widget.preview.properties &&
                                    typeof widget.preview.properties === "object"
                                    ? (widget.preview.properties as Record<string, any>)
                                    : {},
                        }
                        : {
                            template:
                                typeof widget.template === "string" ? widget.template : "columns",
                            properties:
                                widget.properties && typeof widget.properties === "object"
                                    ? (widget.properties as Record<string, any>)
                                    : {},
                        },
            } as WidgetCatalogItem;
        })
        .filter((entry) => !!entry.slug);
}

async function getDefaultWeatherWidgets(): Promise<WidgetCatalogItem[]> {
    const candidatePaths = [
        path.resolve(process.cwd(), "lib/integrations/weather.yaml"),
        path.resolve(process.cwd(), "../lib/integrations/weather.yaml"),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const content = await readFile(candidatePath, "utf-8");
            const parsed = YAML.parse(content) as Record<string, any>;
            const weatherWidgets = parsed?.configuration?.widgets;
            return normalizeWidgetList(weatherWidgets);
        } catch {
            continue;
        }
    }

    return [];
}

async function getDefaultWidgets(): Promise<WidgetCatalog> {
    const candidatePaths = [
        path.resolve(process.cwd(), "lib/integrations/default.yaml"),
        path.resolve(process.cwd(), "../lib/integrations/default.yaml"),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const content = await readFile(candidatePath, "utf-8");
            const parsed = YAML.parse(content) as Record<string, any>;
            const widgets = parsed?.configuration?.widgets;
            const normalized = normalizeWidgetList(widgets);

            if (normalized.length === 0) {
                return {};
            }

            return {
                "integration-default": normalized,
            };
        } catch {
            continue;
        }
    }

    return {};
}

type WeatherInput = {
    lat: string;
    lon: string;
    unit?: string;
};

type WeatherLocation = {
    lat: number;
    lon: number;
    name: string;
};

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

function parseLocationFromGlanceableParams(
    params: Record<string, any> | null | undefined,
): WeatherLocation | null {
    if (!params) return null;

    if (params.locationDisplayname && params.locationCoordinates) {
        if (typeof params.locationCoordinates === "string") {
            const match = params.locationCoordinates.match(
                /^\s*\{\s*'lat'\s*:\s*'([^']+)'\s*,\s*'lon'\s*:\s*'([^']+)'\s*(?:,\s*'name'\s*:\s*'([^']+)')?\s*\}\s*$/,
            );
            if (match) {
                return {
                    name: String(params.locationDisplayname),
                    lat: Number(match[1]),
                    lon: Number(match[2]),
                };
            }
        }

        if (Array.isArray(params.location) && params.location.length >= 2) {
            return {
                name: String(params.locationDisplayname),
                lat: Number(params.location[0]),
                lon: Number(params.location[1]),
            };
        }
    }

    if (typeof params.location?.coordinates === "string") {
        const match = params.location.coordinates.match(
            /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
        );
        if (match) {
            return {
                name: String(params.location.displayName || ""),
                lat: Number(match[1]),
                lon: Number(match[2]),
            };
        }
    }

    return null;
}

function parseLocationFromUserPreferences(raw: unknown): WeatherLocation | null {
    if (!raw || typeof raw !== "string") return null;
    try {
        const normalized = raw.replaceAll("'", '"');
        const parsed = JSON.parse(normalized);
        if (parsed && parsed.lat !== undefined && parsed.lon !== undefined) {
            return {
                name: String(parsed.name || ""),
                lat: Number(parsed.lat),
                lon: Number(parsed.lon),
            };
        }
    } catch {
        return null;
    }
    return null;
}

async function fetchWeather({ lat, lon, unit = "c" }: WeatherInput) {
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

export async function getUserWidgets(userId: string) {
    const merged: WidgetCatalog = JSON.parse(JSON.stringify(await getDefaultWidgets()));
    const pb = await getSuperuserPB();

    const defaultWeatherWidgets = await getDefaultWeatherWidgets();
    if (defaultWeatherWidgets.length > 0) {
        merged["integration-weather"] = defaultWeatherWidgets;
    }

    const list = await pb.collection("integrations").getFullList({
        filter: `user=\"${userId}\"`,
        sort: "-updated",
    });

    for (const record of list) {
        const config = record?.config;
        if (!config || typeof config !== "object") continue;

        const details = (config as Record<string, any>).details;
        const integrationName =
            typeof details?.name === "string" && details.name.trim()
                ? details.name.trim().toLowerCase().replace(/\s+/g, "-")
                : "integrations";

        const rawWidgets = (config as Record<string, any>)?.configuration?.widgets;
        const normalizedWidgets = normalizeWidgetList(rawWidgets);
        if (normalizedWidgets.length === 0) continue;

        const category = `integration-${integrationName}`;
        if (!Array.isArray(merged[category])) {
            merged[category] = [];
        }

        for (const normalized of normalizedWidgets) {
            const exists = merged[category].some((entry) => entry.slug === normalized.slug);
            if (!exists) {
                merged[category].push(normalized);
            }
        }
    }

    return merged;
}

export async function getWidgetData(userId: string, widgetType: string, widget: Record<string, any>) {
    if (widgetType === "link-view") {
        return getHomeLinks(userId);
    }

    return widget?.data;
}



export async function getUserGlanceables(userId: string) {
    
}

export async function getGlanceableData(
    userId: string,
    glanceableType: string,
    glanceable: Record<string, any> | null | undefined,
) {
    const base = glanceable && typeof glanceable === "object" ? glanceable : {};
    if (glanceableType !== "weather") return base;

    let location = parseLocationFromGlanceableParams(base);
    let unit = String(base.unit || "c").toLowerCase();

    if (!location) {
        const pb = await getSuperuserPB();
        const user = await pb.collection("users").getOne(userId);
        const localizationPreferences =
            user?.localizationPreferences && typeof user.localizationPreferences === "object"
                ? user.localizationPreferences
                : {};

        location = parseLocationFromUserPreferences(
            localizationPreferences.weatherLocation,
        );
        if (!base.unit && localizationPreferences.weatherUnit) {
            unit = String(localizationPreferences.weatherUnit).toLowerCase();
        }
    }

    if (!location) return base;

    try {
        const weather = await fetchWeather({
            lat: String(location.lat),
            lon: String(location.lon),
            unit,
        });
        return {
            ...base,
            data: {
                ...weather,
                name: location.name,
            },
            unit,
        };
    } catch {
        return base;
    }
}

export async function hydratePageConfigWidgets(
    userId: string,
    config: Record<string, any>,
) {
    const next = JSON.parse(JSON.stringify(config || {}));
    const columns = next?.columns;
    if (!columns || typeof columns !== "object") return next;

    const columnEntries = Object.values(columns).filter(
        (col) => col && typeof col === "object",
    ) as Record<string, any>[];

    const tasks: Array<Promise<void>> = [];

    for (const entries of columnEntries) {
        for (const [widgetType, widgetCfg] of Object.entries(entries)) {
            const normalizedWidgetCfg =
                widgetCfg && typeof widgetCfg === "object" ? widgetCfg : {};

            tasks.push(
                (async () => {
                    const data = await getWidgetData(
                        userId,
                        widgetType,
                        normalizedWidgetCfg,
                    );

                    console.log(`Hydrated widget data for type "${widgetType}":`, data);

                    entries[widgetType] = data === undefined
                        ? normalizedWidgetCfg
                        : {
                            ...normalizedWidgetCfg,
                            data,
                        };
                })(),
            );

            if (widgetType === "main-clock") {
                const glanceables = normalizedWidgetCfg.glanceables;
                if (glanceables && typeof glanceables === "object") {
                    const glanceableTasks = Object.entries(glanceables).map(
                        async ([glanceableType, glanceableCfg]) => {
                            glanceables[glanceableType] = await getGlanceableData(
                                userId,
                                glanceableType,
                                glanceableCfg as Record<string, any> | null | undefined,
                            );
                        },
                    );
                    tasks.push(Promise.all(glanceableTasks).then(() => undefined));
                }
            }
        }
    }

    await Promise.all(tasks);
    return next;
}
