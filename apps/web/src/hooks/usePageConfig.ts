"use client";

import { getPageConfigAction } from "@/app/actions/pageConfigs";
import useAuth from "@/context/useAuth";
import type { PageConfig } from "@dashwise/sdk/data/pageConfig";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";

const nonPageSegments = new Set(["settings", "notifications", "onboarding", "screensaver", "auth"]);

export function resolveRequestedPageName(pathname: string | null): string {
  const firstSegment = pathname?.split("/").filter(Boolean)[0] ?? "home";
  return nonPageSegments.has(firstSegment) ? "home" : firstSegment;
}

type UsePageConfigOptions = {
  pageName?: string;
};

export function usePageConfig(options?: UsePageConfigOptions) {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { token, withAuth } = useAuth();
  const resolvedPageName = useMemo(
    () => options?.pageName ?? resolveRequestedPageName(pathname),
    [options?.pageName, pathname]
  );

  const [pageConfig, setPageConfig] = useState<PageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patchConfig = useCallback((updater: SetStateAction<PageConfig | null>) => {
    setPageConfig((current) => (typeof updater === "function" ? updater(current) : updater));
  }, []);

  const refreshConfig = useCallback(async () => {
    if (!token) {
      setPageConfig(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await withAuth(
        (auth) => getPageConfigAction(auth, resolvedPageName),
        () => navigate("/auth/login")
      );
      setPageConfig((data ?? {}) as PageConfig);
      setError(null);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 401) {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [navigate, resolvedPageName, token, withAuth]);


  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    const handleUpdated = () => {
      void refreshConfig();
    };
    window.addEventListener("config:updated", handleUpdated);
    return () => window.removeEventListener("config:updated", handleUpdated);
  }, [refreshConfig]);

  return {
    config: pageConfig,
    pageConfig,
    loading,
    error,
    pageName: resolvedPageName,
    patchConfig,
    refreshConfig,
  };
}
