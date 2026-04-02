"use client";

import React from "react";
import type { ResolvedWidget } from "../data/resolveProperties";

interface IconDetailsCardProps {
  resolved: ResolvedWidget;
  className?: string;
}

export default function IconDetailsCard({ resolved, className }: IconDetailsCardProps) {
  const header = resolved.header;
  const card = resolved.card;

  const iconSrc = card?.icon
    ? card.icon.startsWith("/") ? card.icon : `/weather-icons/${card.icon}`
    : null;

  const primary = card?.primary ?? "";
  const secondary = card?.secondary ?? "";

  return (
    <div className={`frosted rounded-lg p-3 ${className ?? ""}`}>
      {header?.show !== false && header?.title && (
        <a
          href={header.titleAction ?? "#"}
          className="font-medium mb-2 grid grid-cols-[18px_1fr_16px] w-full text-start items-center gap-2"
        >
          {header.icon && !header.icon.includes("integrations.") && (
            <img src={header.icon} className="h-4 mx-0.5" alt="" />
          )}
          <p className="font-semibold truncate">{header.title}</p>
        </a>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-2 items-center gap-x-3 gap-y-1">
        <div className="row-span-2 flex h-12 w-12 items-center justify-center rounded-lg bg-black/10 shrink-0">
          {iconSrc ? (
            <img src={iconSrc} className="h-9 w-9 object-contain" alt="" />
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">
            {primary || "—"}
          </p>
        </div>

        <div className="min-w-0">
          {secondary ? (
            <p className="truncate text-sm opacity-75 leading-tight">{secondary}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
