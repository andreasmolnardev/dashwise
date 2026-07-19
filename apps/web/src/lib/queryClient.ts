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
  },
  monitoring: {
    monitors: ["monitoring", "monitors"] as const,
    hosts: ["monitoring", "hosts"] as const,
    sshHosts: ["monitoring", "ssh-hosts"] as const,
  },
  // Scope authenticated resources to the active session so a user switch never
  // renders another user's cached data before its first refetch completes.
  pageConfig: (token: string | null, pageName: string) => ["page-config", token, pageName] as const,
  news: {
    subscriptions: (token: string | null) => ["news", token, "subscriptions"] as const,
    feeds: (token: string | null) => ["news", token, "feeds"] as const,
    savedArticles: (token: string | null, list: string | null) => ["news", token, "saved-articles", list] as const,
  },
};
