"use client";

import { Icon } from "@iconify-icon/react";
import React from "react";
import IntegrationIcon from "./IntegrationIcon";

interface WidgetColumnTemplateProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  url?: string;
  iconUrl?: string;
}

/**
 * Pure layout shell — receives already-resolved strings.
 * Used by Widget.tsx's ColumnsWidget wrapper; also usable standalone.
 */
export default function WidgetColumnTemplate({
  children,
  className = "",
  title = "",
  url = "",
  iconUrl = "",
}: WidgetColumnTemplateProps) {
  return (
    <div
      className={`rounded-lg p-2 justify-center frosted ${className} flex-col`}
    >
      {(title || iconUrl) && (
        <a
          href={url || "#"}
          className="font-medium mb-1 flex w-full text-start items-center gap-2"
        >
          <IntegrationIcon
            source={iconUrl}
            className={`h-4 mx-0.5 ${iconUrl ? "" : "invisible"}`}
            alt=""
            size={16}
          />
          <p className="font-semibold truncate">{title}</p>
          <Icon
            icon="fa6-solid:up-right-from-square"
            className={`text-xs hover:text-primary ${
              url && url !== "#" ? "" : "hidden"
            }`}
          />
        </a>
      )}

      <div className="grid auto-cols-fr grid-flow-col gap-2 text-center">
        {children}
      </div>
    </div>
  );
}
