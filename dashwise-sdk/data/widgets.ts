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

type WeatherLocation = {
    lat: number;
    lon: number;
    name: string;
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
    locationName?: string;
    name?: string;
    input?: Record<string, any>;
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

async function getDefaultGlanceables(): Promise<Array<Record<string, any>>> {
    const [defaultYaml, weatherYaml] = await Promise.all([
        loadIntegrationYaml("lib/integrations/default.yaml"),
        loadIntegrationYaml("lib/integrations/weather.yaml"),
    ]);

    const defaultGlanceables = Array.isArray(defaultYaml?.configuration?.glanceables)
        ? defaultYaml.configuration.glanceables
        : [];
    const weatherGlanceables = Array.isArray(weatherYaml?.configuration?.glanceables)
        ? weatherYaml.configuration.glanceables
        : [];

    const normalize = (
        items: Array<Record<string, any>>,
        fallbackTypes: Record<string, string>,
    ) => items
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
            const displayName =
                typeof entry.name === "string" && entry.name.trim()
                    ? entry.name.trim()
                    : typeof entry.displayName === "string" && entry.displayName.trim()
                        ? entry.displayName.trim()
                        : "Glanceable";
            const normalizedType =
                typeof entry.type === "string" && entry.type.trim()
                    ? entry.type.trim()
                    : fallbackTypes[displayName.toLowerCase()] ?? normalizeWidgetSlug(displayName);

            return {
                type: normalizedType,
                displayName,
                description:
                    typeof entry.description === "string" ? entry.description : undefined,
                exampleProps:
                    entry.exampleProps && typeof entry.exampleProps === "object"
                        ? (entry.exampleProps as Record<string, any>)
                        : entry.properties && typeof entry.properties === "object"
                            ? (entry.properties as Record<string, any>)
                            : {},
                properties:
                    entry.properties && typeof entry.properties === "object"
                        ? (entry.properties as Record<string, any>)
                        : undefined,
            };
        });

    return [
        ...normalize(defaultGlanceables, {
            date: "date",
            greeting: "greeting",
            "local timezone": "local-timezone",
            "world clock": "world-clock",
        }),
        ...normalize(weatherGlanceables, {
            "local weather": "weather",
        }),
    ];
}

type WeatherInput = {
    lat: string;
    lon: string;
    unit?: string;
};

type WeatherIntegrationDefinition = {
    configuration?: {
        lookup_tables?: Record<string, any>;
    };
};

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

export async function getWeatherData({ lat, lon, unit = "c" }: WeatherInput): Promise<WeatherData> {
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

async function resolveWeatherLocation(
    userId: string,
    base: Record<string, any>,
) {
    let location: WeatherLocation | null = null;
    const directLat = base.lat ?? base.latitude;
    const directLon = base.lon ?? base.longitude;

    if (directLat !== undefined && directLat !== null && directLon !== undefined && directLon !== null) {
        const lat = Number(directLat);
        const lon = Number(directLon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            location = {
                lat,
                lon,
                name: String(base.displayName ?? base.locationName ?? base.name ?? ""),
            };
        }
    }

    if (!location) {
        location = parseLocationFromGlanceableParams(base);
    }
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

    return { location, unit };
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

    const widgetData = widget?.data && typeof widget.data === "object" ? widget.data : null;
    const widgetInput = widgetData?.input && typeof widgetData.input === "object" ? widgetData.input : {};

    if (widgetType.toLowerCase().includes("weather") || widgetData?.source === "computed.weather") {
        const { location, unit } = await resolveWeatherLocation(userId, {
            ...widgetInput,
            unit: widgetInput.unit ?? widget?.unit,
            displayName: widgetInput.displayName ?? widgetInput.locationName,
        });

        if (!location) {
            return widget?.data;
        }

        try {
            const weather = await getWeatherData({
                lat: String(location.lat),
                lon: String(location.lon),
                unit,
            });

            return {
                ...widget?.data,
                ...weather,
                name: location.name,
                locationName: location.name,
                input: widgetInput,
            };
        } catch {
            return widget?.data;
        }
    }

    return widget?.data;
}



export async function getUserGlanceables(userId: string) {
    void userId;
    return getDefaultGlanceables();
}

export async function getGlanceableData(
    userId: string,
    glanceableType: string,
    glanceable: Record<string, any> | null | undefined,
) {
    const base = glanceable && typeof glanceable === "object" ? glanceable : {};
    if (glanceableType !== "weather") return base;

    const { location, unit } = await resolveWeatherLocation(userId, base);

    if (!location) return base;

    try {
        const weather = await getWeatherData({
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
