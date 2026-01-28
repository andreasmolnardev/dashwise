"use client";

import { useConfig } from "@/context/ConfigContext";
import { useRouter, usePathname } from "next/navigation";

export default function PagesTabs() {
   const { config, refreshConfig } = useConfig();
  const router = useRouter();
  const pathname = usePathname();

  const selectedPage = pathname?.split("/").filter(Boolean)[0] || "";

  if (!config?.pages || config?.pages.length < 2) return <div></div>;

  return (
    <nav className="flex gap-2 items-center justify-center">
      {config.pages.map((page) => (
        <button
          key={page}
          onClick={() => {
            router.push(`/${page}`);
          }}
          className={`py-1 px-2 rounded-full ${
            selectedPage === page ? "frosted" : "bg-transparent"
          }`}
        >
          {page.charAt(0).toUpperCase() + page.slice(1)}
        </button>
      ))}
    </nav>
  );
}
