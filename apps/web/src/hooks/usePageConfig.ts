"use client";

import { getPageConfigAction } from '@/lib/apiClient';
import useAuth from "@/context/useAuth";
import { queryKeys } from "@/lib/queryClient";
import type { PageConfig } from "@dashwise/types/sdk";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, type SetStateAction } from "react";
import { homelabProduct } from "@/products/homelab";
import { resolvePageConfigName, routeMetadata } from "@/platform/routing/metadata";
import { applicationRouteMetadata } from "@/platform/routing/application-routes";

export function resolveRequestedPageName(pathname: string | null): string {
  const normalizedPathname = pathname ?? "/home";
  const pageConfig = (routeMetadata(normalizedPathname, homelabProduct.modules) ?? applicationRouteMetadata(normalizedPathname))?.pageConfig;
  if (pageConfig) return resolvePageConfigName(normalizedPathname, pageConfig.mode, pageConfig.pageName);
  return normalizedPathname.split("/").filter(Boolean)[0] ?? "home";
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
