
import config from "./config.ts";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type UserConfig = {
    id: string;
    associatedUserId: string;
    config: {
        links?: {
            name: string;
            icon: string;
            linkGroup: string;
            url: string;
        }[];
        integrations?: {
            Karakeep?: {
                api_token: string;
                server_location: string;
            };
            Jellyfin?: {
                api_token: string;
                server_location: string;
            };
            Beszel?: {
                server_location: string;
                pb_email: string;
                pb_password: string;
            }
            Dashdot?: {
                server_location: string;
                server_displayname?: string;
            };
            News?: Record<string, never>;
            Notifications?: Record<string, never>;
        };
    };
};

type UserSearchItem = {
    id?: string;
    associatedUserId: string;
    searchItems: string; // JSON string of all search items
};

type IntegrationRecord = {
    id: string;
    name?: string | null;
    type?: "plugin" | "caldav";
    source?: string | null;
    config?: unknown;
    environment?: unknown;
};

export type SearchItem = {
    id?: string;
    name: string;
    icon: string;
    secondaryInfo: string;
    type: "link" | "app" | "karakeepBookmark" | "jellyfinItem" | "beszelItem" | "dashdotItem" | "caldavItem";
    action: string;
    tags?: string[];
    parentId?: string;
};

function mapSearchItemsToJSON(items: SearchItem[]) {
    return JSON.stringify(
        items
            .map(i => ({
                name: i.name,
                icon: i.icon,
                secondaryInfo: i.secondaryInfo,
                type: i.type,
                action: i.action,
                tags: i.tags,
                parentId: i.parentId
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    );
}

function createIntegrationRootItem({
    id,
    name,
    icon,
}: {
    id: string;
    name: string;
    icon: string;
}): SearchItem {
    return {
        id,
        name,
        icon,
        secondaryInfo: "Integration",
        type: "app",
        action: `app:${id}`,
        tags: [name, "integration"],
    };
}

function normalizeObject(raw: unknown) {
    if (!raw) return {} as Record<string, any>;
    if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
    if (typeof raw !== "string") return {} as Record<string, any>;

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, any>;
        }
    } catch {
    }

    try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, any>;
        }
    } catch {
    }

    return {} as Record<string, any>;
}

function decodeMaybeBase64(value: string | undefined | null) {
    if (!value) return "";
    try {
        const decoded = Buffer.from(value, "base64").toString("utf8");
        if (decoded && /[\x20-\x7E]/.test(decoded)) {
            return decoded;
        }
        return value;
    } catch {
        return value;
    }
}

function normalizeEnvironment(raw: unknown) {
    const parsed = normalizeObject(raw);
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined || value === null) continue;
        result[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    return result;
}

function resolveIntegrationName(integration: {
    name?: string | null;
    source?: string | null;
    config?: Record<string, any>;
}) {
    return (
        integration.name ||
        integration.config?.details?.name ||
        integration.source ||
        ""
    );
}

function getEnv(environment: Record<string, string>, keys: string[]) {
    for (const key of keys) {
        const value = environment[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return decodeMaybeBase64(String(value));
        }
    }
    return "";
}

function toSlug(value: string) {
    return value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}


export default async function runBackgroundJobs() {
    try {
        const pb = await getSuperuserPB();
        const configs = await pb.collection("userConfig").getFullList<UserConfig>()

        for (const userConfig of configs) {
            const associatedUserId = userConfig.associatedUserId;
            if (!associatedUserId) continue;

            const links = userConfig.config?.links ?? [];

            let searchItems: SearchItem[];

            //initially, its just an array of links
            searchItems = links.map(link => ({
                name: link.name,
                icon: link.icon,
                secondaryInfo: link.linkGroup,
                type: "link",
                action: `url:${link.url}`,
                tags: [link.name, link.linkGroup, link.url.match(/^(?:https?:\/\/)?(?:www\.)?(?:[\w-]+\.)*([\w-]+)\.(?:[\w-]{2,}(?:\.[\w-]{2,})?)$/)?.[1]].filter((t): t is string => !!t)
            }));

            const integrationRecords = await pb.collection("integrations").getFullList<IntegrationRecord>({
                filter: `user="${associatedUserId}"`,
                sort: "-updated",
            }).catch(() => [] as IntegrationRecord[]);

            for (const integrationRecord of integrationRecords) {
                const integrationConfig = normalizeObject(integrationRecord.config);
                const integrationEnvironment = normalizeEnvironment(integrationRecord.environment);
                const integrationName = resolveIntegrationName({
                    name: integrationRecord.name,
                    source: integrationRecord.source,
                    config: integrationConfig,
                });
                if (!integrationName) {
                    continue;
                }

                const integrationIcon = integrationConfig?.details?.icon || "/icons/faGlobe.svg";
                const appId = `integration:${integrationRecord.id || toSlug(integrationName)}`;
                searchItems.push(createIntegrationRootItem({
                    id: appId,
                    name: integrationName,
                    icon: integrationIcon,
                }));

                const lowerName = integrationName.toLowerCase();

            }

            const desiredJson = mapSearchItemsToJSON(searchItems);

            // Check for existing record
            const existing = await pb.collection("userSearchItems")
                .getFirstListItem<UserSearchItem>(`associatedUserId="${associatedUserId}"`)
                .catch(() => null);


            if (existing) {
                // Update only if different
                if (existing.searchItems !== desiredJson) {
                    await pb.collection("userSearchItems").update(existing.id!, {
                        searchItems: desiredJson,
                    });
                }
            } else {
                // Create new
                await pb.collection("userSearchItems").create({
                    associatedUserId,
                    searchItems: desiredJson,
                });
            }
        }
    } catch (error) {
        console.error("Error generating user search items:", error);
    }
}
