import { authHeaders, backendUrl } from "@/lib/apiClient";
import type { ActionAuth } from "@/lib/apiClient";

type ResourceResult = {
  id?: string;
  type?: string;
  providerResourceId?: string;
  data?: Record<string, unknown>;
};

export type ResourceSearchShortcut = {
  id: string;
  name: string;
  url: string;
  icon?: string;
  secondaryInfo?: string;
  type: string;
  tags?: string[];
  isPinned?: boolean;
};

/** Search shared resources while keeping the existing command bar result shape. */
export async function searchDashwiseResources(auth: ActionAuth, query: string): Promise<ResourceSearchShortcut[]> {
  const url = new URL(backendUrl("/api/v1/resources"));
  url.searchParams.set("search", query.trim());
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { headers: authHeaders(auth) });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { items?: ResourceResult[] } | null;
  return (payload?.items ?? []).flatMap((resource) => {
    const data = resource.data ?? {};
    const type = resource.type ?? "";
    if (!["dashwise.link", "dashwise.shortcut", "news.article"].includes(type)) return [];
    const name = text(data.title) || text(data.name);
    const target = text(data.url);
    if (!name || !target) return [];
    return [{
      id: resource.id ?? `${type}:${resource.providerResourceId ?? name}`,
      name,
      url: target,
      icon: text(data.iconUrl) || text(data.icon) || undefined,
      secondaryInfo: text(data.collectionName) || text(data.source) || text(data.description) || undefined,
      type: type === "news.article" ? "News" : type === "dashwise.shortcut" ? "Shortcut" : "Link",
      tags: stringList(data.tags),
      isPinned: data.favorite === true || data.isPinned === true,
    }];
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
