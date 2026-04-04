"use client";

import React from "react";
import IntegrationIcon from "./IntegrationIcon";
import type { ResolvedWidget } from "../data/resolveProperties";

interface IconDetailsCardProps {
  resolved: ResolvedWidget;
  className?: string;
}

export default function IconDetailsCard({ resolved, className }: IconDetailsCardProps) {
  const header = resolved.header;
  const card = resolved.card;
  const iconSrc = card?.icon ?? null;

  const primary = card?.primary ?? "";
  const secondary = card?.secondary ?? "";

  return (
    <div className={`frosted rounded-lg p-3 ${className ?? ""}`}>
      {header?.show !== false && header?.title && (
        <a
          href={header.titleAction ?? "#"}
          className="font-medium mb-2 flex w-full text-start items-center gap-2"
        >
          <IntegrationIcon source={header.icon} className="h-4 mx-0.5" alt="" size={16} />
          <p className="font-semibold truncate">{header.title}</p>
        </a>
      )}

      <div className="flex items-center gap-x-3 gap-y-1">
        <div className="row-span-2 flex h-12 w-12 items-center justify-center rounded-lg bg-black/10 shrink-0">
          <IntegrationIcon
            source={iconSrc ?? undefined}
            className="h-9 w-9 object-contain"
            alt=""
            size={36}
            useFrostedGradient={card?.icon?.useFrostedGradient}
          />
        </div>

        <div className="min-w-0 space-y-1">
          <p className="truncate text-lg font-semibold leading-tight">
            {primary || "—"}
          </p>
          {secondary ? (
            <p className="truncate text-sm opacity-75 leading-tight">{secondary}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
