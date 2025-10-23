"use client";

import { useConfig } from "@/context/ConfigContext";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PagesTabs() {
   const { config, refreshConfig } = useConfig();
  const router = useRouter();
  const [selectedPage, setSelectedPage] = useState(config?.pages?.[0] || "");

  if (!config?.pages || config?.pages.length < 2) return null;

  return (
    <nav className="flex gap-2 items-center justify-center">
      {config.pages.map((page) => (
        <button
          key={page}
          onClick={() => {
            setSelectedPage(page);
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
