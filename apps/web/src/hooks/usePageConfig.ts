"use client";

import { getPageConfigAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import { queryKeys } from "@/lib/queryClient";
import type { PageConfig } from "@dashwise/types/sdk";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, type SetStateAction } from "react";

const nonPageSegments = new Set(["settings", "notifications", "onboarding", "screensaver", "auth", "frame"]);

export function resolveRequestedPageName(pathname: string | null): string {
  const firstSegment = pathname?.split("/").filter(Boolean)[0] ?? "home";
  return nonPageSegments.has(firstSegment) ? "home" : firstSegment;
}

type UsePageConfigOptions = {
  pageName?: string;
};

export function usePageConfig(options?: UsePageConfigOptions) {
  const pathname = useLocation().pathname;
  const { token } = useAuth();
  const resolvedPageName = useMemo(
    () => options?.pageName ?? resolveRequestedPageName(pathname),
    [options?.pageName, pathname]
  );

  const queryClient = useQueryClient();
  const queryKey = useMemo(() => queryKeys.pageConfig(token, resolvedPageName), [resolvedPageName, token]);
  const pageConfigQuery = useQuery({
    queryKey,
    enabled: Boolean(token),
    queryFn: () => getPageConfigAction({ token }, resolvedPageName),
  });
  const pageConfig = pageConfigQuery.data === undefined
    ? null
    : (pageConfigQuery.data ?? {}) as PageConfig;

  const patchConfig = useCallback((updater: SetStateAction<PageConfig | null>) => {
    queryClient.setQueryData<PageConfig | null>(queryKey, (current) =>
      typeof updater === "function" ? updater(current ?? null) : updater,
    );
  }, [queryClient, queryKey]);

  const refreshConfig = useCallback(async () => {
    if (!token) return;
    await pageConfigQuery.refetch();
  }, [pageConfigQuery, token]);

  useEffect(() => {
    const handleUpdated = () => {
      void queryClient.invalidateQueries({ queryKey });
    };
    window.addEventListener("config:updated", handleUpdated);
    return () => window.removeEventListener("config:updated", handleUpdated);
  }, [queryClient, queryKey]);

  return {
    config: pageConfig,
    pageConfig,
    loading: pageConfigQuery.isLoading,
    error: pageConfigQuery.error instanceof Error ? pageConfigQuery.error.message : null,
    pageName: resolvedPageName,
    patchConfig,
    refreshConfig,
  };
}
