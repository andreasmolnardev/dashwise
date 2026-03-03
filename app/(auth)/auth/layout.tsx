"use client";

import { ReactNode, useEffect } from "react";

const FROSTED_LIGHT = "frosted-theme-light";
const FROSTED_DARK = "frosted-theme-dark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const previousColorScheme = root.style.colorScheme || "";
    const hadDarkClass = root.classList.contains("dark");
    const previousFrostedTheme = root.classList.contains(FROSTED_DARK)
      ? "dark"
      : root.classList.contains(FROSTED_LIGHT)
      ? "light"
      : undefined;

    root.classList.remove("dark");
    root.style.colorScheme = "light";
    root.classList.remove(FROSTED_DARK, FROSTED_LIGHT);
    root.classList.add(FROSTED_LIGHT);

    return () => {
      if (typeof document === "undefined") return;
      const cleanupRoot = document.documentElement;

      cleanupRoot.style.colorScheme = previousColorScheme;
      if (hadDarkClass) cleanupRoot.classList.add("dark");
      else cleanupRoot.classList.remove("dark");

      cleanupRoot.classList.remove(FROSTED_DARK, FROSTED_LIGHT);
      if (previousFrostedTheme === "dark") {
        cleanupRoot.classList.add(FROSTED_DARK);
      } else if (previousFrostedTheme === "light") {
        cleanupRoot.classList.add(FROSTED_LIGHT);
      }
    };
  }, []);

  return <>{children}</>;
}
