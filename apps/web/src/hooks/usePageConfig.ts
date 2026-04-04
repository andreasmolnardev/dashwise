"use client";

import { getPageConfigAction } from "@/app/actions/pageConfigs";
import useAuth from "@/context/useAuth";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  const [pageConfig, setPageConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshConfig = useCallback(async () => {
    if (!token) {
      setPageConfig({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await withAuth(
        (auth) => getPageConfigAction(auth, resolvedPageName),
        () => navigate("/auth/login")
      );
      setPageConfig(data ?? {});
      setError(null);
    } catch (err: any) {
      if (err?.status === 401) {
        return;
      }
      setError(err?.message ?? "Unknown error");
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
    pageConfig,
    loading,
    error,
    pageName: resolvedPageName,
    refreshConfig,
  };
}
