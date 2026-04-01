import { getHomeLinks } from "./links";
import { resolveWidgetDefinition } from "./integrations";
import { getWeather } from "./weather";
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
        const environment = record?.environment;
        const stringifiedEnvironment = environment && typeof environment === "object"
            ? Object.fromEntries(
                Object.entries(environment as Record<string, any>)
                    .filter(([, value]) => value !== undefined && value !== null)
                    .map(([key, value]) => [key, String(value)]),
            )
            : {};

        const details = (config as Record<string, any>).details;
        const integrationName =
            typeof details?.name === "string" && details.name.trim()
                ? details.name.trim().toLowerCase().replace(/\s+/g, "-")
                : "integrations";

        const rawWidgets = (config as Record<string, any>)?.configuration?.widgets;
        if (!Array.isArray(rawWidgets) || rawWidgets.length === 0) continue;

        const resolvedWidgets: WidgetCatalogItem[] = rawWidgets
            .filter((entry): entry is Record<string, any> => !!entry && typeof entry === "object")
            .map((entry) => {
                const resolved = resolveWidgetDefinition(
                    entry as Record<string, unknown>,
                    config as Record<string, unknown>,
                    stringifiedEnvironment,
                );
                if (!resolved) return null;

                return {
                    slug: resolved.slug,
                    name: resolved.name,
                    description:
                        typeof entry.description === "string" ? entry.description : undefined,
                    template: resolved.template,
                    properties: (resolved.properties ?? {}) as Record<string, any>,
                    data: resolved.data as WidgetCatalogItem["data"],
                    exampleProps: (resolved.exampleProps ?? {}) as Record<string, any>,
                    preview: resolved.preview
                        ? {
                            template: resolved.preview.template,
                            properties: (resolved.preview.properties ?? {}) as Record<string, any>,
                        }
                        : {
                            template: resolved.template,
                            properties: (resolved.properties ?? {}) as Record<string, any>,
                        },
                };
            })
            .filter((entry): entry is WidgetCatalogItem => !!entry);

        if (resolvedWidgets.length === 0) continue;

        const category = `integration-${integrationName}`;
        if (!Array.isArray(merged[category])) {
            merged[category] = [];
        }

        for (const resolved of resolvedWidgets) {
            const exists = merged[category].some((entry) => entry.slug === resolved.slug);
            if (!exists) {
                merged[category].push(resolved);
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
            const weather = await getWeather({
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
        const weather = await getWeather({
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
