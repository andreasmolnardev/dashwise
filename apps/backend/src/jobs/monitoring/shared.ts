export type StatusCheckMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

const LINK_SOURCE_PREFIX = "link ";

export function parseConfigObject(rawConfig: any): any {
    if (!rawConfig) return {};
    if (typeof rawConfig === "string") {
        try {
            return JSON.parse(rawConfig);
        } catch {
            return {};
        }
    }
    return rawConfig;
}

export function getLinkSource(linkId: string) {
    return `${LINK_SOURCE_PREFIX}${linkId}`;
}

export function getLinkIdFromSource(source: unknown) {
    const value = String(source || "");
    return value.startsWith(LINK_SOURCE_PREFIX) ? value.slice(LINK_SOURCE_PREFIX.length) : undefined;
}

export function isLinkSource(source: unknown) {
    return String(source || "").startsWith(LINK_SOURCE_PREFIX);
}
