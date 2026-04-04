"use client";

import { usePageConfig } from "@/hooks/usePageConfig";
import { useLocation, useNavigate } from "react-router-dom";

export default function PagesTabs() {
   const { config, refreshConfig } = usePageConfig();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;

  const selectedPage = pathname?.split("/").filter(Boolean)[0] || "";

  if (!config?.pages || config?.pages.length < 2) return <div></div>;

  return (
    <nav className="flex gap-2 items-center justify-center">
      {config.pages.map((page) => (
        <button
          key={page}
          onClick={() => {
            navigate(`/${page}`);
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
