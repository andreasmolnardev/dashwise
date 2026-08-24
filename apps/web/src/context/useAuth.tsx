"use client"

import { updateUserPropertyAction } from '@/lib/apiClient';
import type { ActionAuth, AuthUserRecord, UserPropertyValue } from "@dashwise/types/sdk";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type AuthUser = AuthUserRecord;

const EMPTY_AUTH_USER: AuthUser = {};
export const COMMAND_BAR_OPEN_EVENT = "dashwise:open-command-bar";

function createUnauthorizedError() {
  const error = new Error("Unauthorized") as Error & { status: number; body: { error: string } };
  error.status = 401;
  error.body = { error: "Unauthorized" };
  return error;
}

export function useAuth() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("pb_user") : null;
      return raw ? (JSON.parse(raw) as AuthUser) : EMPTY_AUTH_USER;
    } catch (e) {
      return EMPTY_AUTH_USER;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;

      const localToken = localStorage.getItem("pb_token");
      if (localToken) return localToken;

      const cookieToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('pb_token='))
        ?.split('=')[1];

      if (cookieToken) {
        localStorage.setItem("pb_token", cookieToken);
        return cookieToken;
      }

      return null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pb_user") {
        try {
          setUser(e.newValue ? (JSON.parse(e.newValue) as AuthUser) : EMPTY_AUTH_USER);
        } catch (err) {
          setUser(EMPTY_AUTH_USER);
        }
      }
      if (e.key === "pb_token") {
        setToken(e.newValue);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAuth = useCallback((u: AuthUser | null, t?: string | null) => {
    try {
      if (u === null) {
        localStorage.removeItem("pb_user");
        setUser(EMPTY_AUTH_USER);
      } else {
        localStorage.setItem("pb_user", JSON.stringify(u));
        setUser(u);
      }

      if (t === undefined || t === null) {
        localStorage.removeItem("pb_token");
        setToken(null);
      } else {
        localStorage.setItem("pb_token", t);
        setToken(t);
      }
    } catch (err) {
      // ignore storage errors
    }
  }, []);

  const setTokenOnly = useCallback((t?: string | null) => {
    try {
      if (t === undefined || t === null) {
        localStorage.removeItem("pb_token");
        setToken(null);
      } else {
        localStorage.setItem("pb_token", t);
        setToken(t);
      }
    } catch (err) {
      // ignore storage errors
    }
  }, []);

  const logout = useCallback(() => {
    try {
      setAuth(null, null);

      if (typeof document !== "undefined") {
        document.cookie = "pb_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure";
        document.cookie = "pb_user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure";
      }
      // The token is part of authenticated keys, but removing these entries as
      // well prevents stale data accumulating across repeated account changes.
      queryClient.removeQueries({ queryKey: ["api"] });
      queryClient.removeQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes(token) });
    } catch (err) {
      // ignore
    }
  }, [queryClient, setAuth, token]);

  const withAuth = useCallback(
    async <T,>(fn: (auth: ActionAuth) => Promise<T>, onUnauthorized?: () => void): Promise<T> => {
      if (!token) {
        onUnauthorized?.();
        throw createUnauthorizedError();
      }
      try {
        return await fn({ token });
      } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 401) {
          onUnauthorized?.();
        }
        throw err;
      }
    },
    [token]
  );

  const redirectToLogin = useCallback(() => {
    logout();
    navigate("/auth/login", { replace: true });
  }, [logout, navigate]);

  const openCommandBar = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(COMMAND_BAR_OPEN_EVENT));
    }
  }, []);

  const withAuthRedirect = useCallback(
    async <T,>(fn: (auth: ActionAuth) => Promise<T>): Promise<T> => {
      return withAuth(fn, redirectToLogin);
    },
    [redirectToLogin, withAuth]
  );

  const updateUserPropertyMutation = useMutation({
    mutationFn: async ({ propertyName, propertyValue }: { propertyName: string; propertyValue: UserPropertyValue }) =>
      withAuth((auth) => updateUserPropertyAction(auth, propertyName, propertyValue)),
    onSuccess: (updatedUser) => setAuth(updatedUser, token),
  });

  const updateUserProperty = useCallback(
    (propertyName: string, propertyValue: UserPropertyValue) =>
      updateUserPropertyMutation.mutateAsync({ propertyName, propertyValue }),
    [updateUserPropertyMutation],
  );

  return { user, token, setAuth, setToken: setTokenOnly, logout, withAuth, withAuthRedirect, redirectToLogin, openCommandBar, updateUserProperty };
}


export default useAuth;
