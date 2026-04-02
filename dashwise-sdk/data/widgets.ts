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
    key: string;
    index?: number;
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

type GlanceableCatalogItem = {
    type: string;
    displayName: string;
    description?: string;
    exampleProps: Record<string, any>;
    properties?: Record<string, any>;
};

function sortWidgetsByIndex<T extends { index?: number }>(widgets: T[]) {
    return [...widgets]
        .map((widget, position) => ({ widget, position }))
        .sort((left, right) => {
            const leftIndex = typeof left.widget.index === "number" && Number.isFinite(left.widget.index)
                ? left.widget.index
                : Number.MAX_SAFE_INTEGER;
            const rightIndex = typeof right.widget.index === "number" && Number.isFinite(right.widget.index)
                ? right.widget.index
                : Number.MAX_SAFE_INTEGER;

            if (leftIndex !== rightIndex) return leftIndex - rightIndex;
            return left.position - right.position;
        })
        .map(({ widget }) => widget);
}

function normalizeWidgetSlug(value: string) {
    return value
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
}

function normalizeWidgetList(rawWidgets: unknown): WidgetCatalogItem[] {
    if (!Array.isArray(rawWidgets)) return [];

    const list = rawWidgets
        .filter((entry): entry is Record<string, any> => !!entry && typeof entry === "object")
        .map((widget) => {
            const label =
                typeof widget.name === "string" && widget.name.trim()
                    ? widget.name.trim()
                    : "Integration Widget";
            const explicitKey = typeof widget.key === "string" ? widget.key.trim() : "";
            const explicitSlug = typeof widget.slug === "string" ? widget.slug.trim() : "";
            const slug = explicitKey || explicitSlug || normalizeWidgetSlug(label);

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
                key: slug,
                index: typeof widget.index === "number" && Number.isFinite(widget.index)
                    ? widget.index
                    : undefined,
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
        .filter((entry) => !!entry.key);

            return sortWidgetsByIndex(list);
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

async function getDefaultWeatherWidgets(): Promise<WidgetCatalogItem[]> {
    const candidatePaths = [
        path.resolve(process.cwd(), "lib/integrations/weather.yaml"),
        path.resolve(process.cwd(), "../lib/integrations/weather.yaml"),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const content = await readFile(candidatePath, "utf-8");
            const parsed = YAML.parse(content) as Record<string, any>;
            const widgets = parsed?.configuration?.widgets;
            return normalizeWidgetList(widgets);
        } catch {
            continue;
        }
    }

    return [];
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

function normalizeGlanceables(
    items: unknown,
    fallbackTypes: Record<string, string>,
): GlanceableCatalogItem[] {
    if (!Array.isArray(items)) return [];

    return items
        .filter((entry): entry is Record<string, any> => !!entry && typeof entry === "object")
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

            const result: GlanceableCatalogItem = {
                type: normalizedType,
                displayName,
                exampleProps:
                    entry.exampleProps && typeof entry.exampleProps === "object"
                        ? (entry.exampleProps as Record<string, any>)
                        : entry.properties && typeof entry.properties === "object"
                            ? (entry.properties as Record<string, any>)
                            : {},
            };

            if (typeof entry.description === "string") {
                (result as any).description = entry.description;
            }

            if (entry.properties && typeof entry.properties === "object") {
                (result as any).properties = entry.properties as Record<string, any>;
            }

            return result;
        });
}

function mergeGlanceables(...groups: GlanceableCatalogItem[][]) {
    const merged = new Map<string, GlanceableCatalogItem>();

    for (const group of groups) {
        for (const glanceable of group) {
            if (!merged.has(glanceable.type)) {
                merged.set(glanceable.type, glanceable);
            }
        }
    }

    return Array.from(merged.values());
}

async function getDefaultGlanceables(): Promise<GlanceableCatalogItem[]> {
    const [defaultYaml, weatherYaml] = await Promise.all([
        loadIntegrationYaml("lib/integrations/default.yaml"),
        loadIntegrationYaml("lib/integrations/weather.yaml"),
    ]);

    return mergeGlanceables(
        normalizeGlanceables(defaultYaml?.configuration?.glanceables, {
            date: "date",
            greeting: "greeting",
            "local timezone": "local-timezone",
            "world clock": "world-clock",
        }),
        normalizeGlanceables(weatherYaml?.configuration?.glanceables, {
            "local weather": "weather",
        }),
    );
}

async function getIntegrationGlanceables(userId: string): Promise<GlanceableCatalogItem[]> {
    const pb = await getSuperuserPB();
    const list = await pb.collection("integrations").getFullList({
        filter: `user="${userId}"`,
        sort: "-updated",
    });

    const glanceables: GlanceableCatalogItem[] = [];

    for (const record of list) {
        const config = record?.config;
        if (!config || typeof config !== "object") continue;

        const rawGlanceables = (config as Record<string, any>)?.configuration?.glanceables;
        const normalized = normalizeGlanceables(rawGlanceables, {});
        if (normalized.length === 0) continue;

        glanceables.push(...normalized);
    }

    return glanceables;
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
            const exists = merged[category].some((entry) => entry.key === normalized.key);
            if (!exists) {
                merged[category].push(normalized);
            }
        }
    }

    for (const [category, widgets] of Object.entries(merged)) {
        merged[category] = sortWidgetsByIndex(widgets);
    }

    return merged;
}

export async function getUserGlanceable(userId: string) {
    const [defaultGlanceables, integrationGlanceables] = await Promise.all([
        getDefaultGlanceables(),
        getIntegrationGlanceables(userId),
    ]);

    return mergeGlanceables(defaultGlanceables, integrationGlanceables);
}

export async function getUserGlanceables(userId: string) {
    return getUserGlanceable(userId);
}