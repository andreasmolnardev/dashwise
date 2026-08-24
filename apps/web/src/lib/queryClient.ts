import { QueryClient } from "@tanstack/react-query";

function shouldRetry(failureCount: number, error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;

  return !(status && status >= 400 && status < 500) && failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  appConfig: ["app-config"] as const,
  auth: {
    validation: (token: string | null) => ["auth", token, "validation"] as const,
  },
  links: {
    collections: ["links", "collections"] as const,
    tags: ["links", "tags"] as const,
    folders: (listId: string) => ["links", "folders", listId] as const,
    items: (listId: string, folderId?: string) => ["links", "items", listId, folderId ?? null] as const,
    home: ["links", "home"] as const,
    search: ["links", "search"] as const,
    tagDetail: (tagId: string) => ["links", "tag-detail", tagId] as const,
  },
  monitoring: {
    monitors: ["monitoring", "monitors"] as const,
    hosts: ["monitoring", "hosts"] as const,
    sshHosts: ["monitoring", "ssh-hosts"] as const,
    monitor: (monitorId: string) => ["monitoring", "monitor", monitorId] as const,
    host: (hostId: string) => ["monitoring", "host", hostId] as const,
    history: (monitorId: string, range?: string) => ["monitoring", "history", monitorId, range ?? null] as const,
    status: (monitorId: string) => ["monitoring", "status", monitorId] as const,
  },
  // Scope authenticated resources to the active session so a user switch never
  // renders another user's cached data before its first refetch completes.
  pageConfig: (token: string | null, pageName: string) => ["page-config", token, pageName] as const,
  news: {
    subscriptions: (token: string | null) => ["news", token, "subscriptions"] as const,
    feeds: (token: string | null) => ["news", token, "feeds"] as const,
    savedArticlesRoot: (token: string | null) => ["news", token, "saved-articles"] as const,
    savedArticles: (token: string | null, list: string | null) => ["news", token, "saved-articles", list] as const,
    feedRoot: (token: string | null) => ["news", token, "feed"] as const,
    feed: (token: string | null, feedId: string, page: number) => ["news", token, "feed", feedId, page] as const,
    metadata: (token: string | null, feedId: string) => ["news", token, "metadata", feedId] as const,
  },
  notifications: {
    items: (token: string | null, unread = false) => ["notifications", token, "items", unread] as const,
    topics: (token: string | null) => ["notifications", token, "topics"] as const,
    tokens: (token: string | null) => ["notifications", token, "tokens"] as const,
    forwarders: (token: string | null) => ["notifications", token, "forwarders"] as const,
  },
  settings: {
    widgets: (token: string | null) => ["settings", token, "widgets"] as const,
    glanceables: (token: string | null) => ["settings", token, "glanceables"] as const,
    locations: (token: string | null) => ["settings", token, "locations"] as const,
    integrations: (token: string | null) => ["settings", token, "integrations"] as const,
  },
};
