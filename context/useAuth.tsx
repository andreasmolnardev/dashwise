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
      return typeof window !== "undefined" ? localStorage.getItem("pb_token") : null;
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

  const logout = useCallback(() => {
    setAuth(null, null);
  }, [setAuth]);

  return { user, token, setAuth, logout };
}

export default useAuth;
