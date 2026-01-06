"use client"

import { useCallback, useEffect, useState } from "react";

type AuthUser = any | null;

export function useAuth() {
  const [user, setUser] = useState<AuthUser>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("pb_user") : null;
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      
      // First check localStorage
      const localToken = localStorage.getItem("pb_token");
      if (localToken) return localToken;
      
      // If no localStorage token, check cookies (from SSO callback)
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
          setUser(e.newValue ? JSON.parse(e.newValue) : null);
        } catch (err) {
          setUser(null);
        }
      }
      if (e.key === "pb_token") {
        setToken(e.newValue);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAuth = useCallback((u: AuthUser, t?: string | null) => {
    try {
      if (u === null) {
        localStorage.removeItem("pb_user");
        setUser(null);
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
    } catch (err) {
      // ignore
    }
  }, [setAuth]);

  return { user, token, setAuth, setToken: setTokenOnly, logout };
}

export default useAuth;
