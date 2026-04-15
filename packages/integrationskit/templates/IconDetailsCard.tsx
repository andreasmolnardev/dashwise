"use client";

import React from "react";
import AppIcon from "@dashwise/app-icon";
import type { ResolvedWidget } from "../types";
import { renderLocalizedText, type TextFormatters } from "../data/renderText";

interface IconDetailsCardProps {
  resolved: ResolvedWidget;
  className?: string;
  formatters?: TextFormatters;
}

export default function IconDetailsCard({ resolved, className, formatters }: IconDetailsCardProps) {
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
          <AppIcon source={header.icon} className="h-4 mx-0.5" alt="" size={16} />
          <p className="font-semibold truncate">{renderLocalizedText(header.title, formatters)}</p>
        </a>
      )}

      <div className="flex items-center gap-x-3 gap-y-1">
        <div className="row-span-2 flex h-12 w-12 items-center justify-center rounded-lg shrink-0">
          <AppIcon
            source={iconSrc ?? undefined}
            className="h-9 w-9 object-contain"
            alt=""
            size={36}
          />
        </div>

        <div className="min-w-0 space-y-1">
          <p className="truncate text-lg font-semibold leading-tight">
            {primary ? renderLocalizedText(primary, formatters) : "—"}
          </p>
          {secondary ? (
            <p className="truncate text-sm opacity-75 leading-tight">{renderLocalizedText(secondary, formatters)}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
