"use client";

import React from "react";
import AppIcon from "@dashwise/app-icon";
import { Icon } from "@iconify-icon/react";
import type { ResolvedWidget } from "../types";
import { renderLocalizedText, type TextFormatters } from "../data/renderText";

interface IframeTemplateProps {
  resolved: ResolvedWidget;
  className?: string;
  formatters?: TextFormatters;
}

export default function IframeTemplate({
  resolved,
  className = "",
  formatters,
}: IframeTemplateProps) {
  const { header, iframe } = resolved;
  const title = header?.show !== false ? renderLocalizedText(header?.title ?? "", formatters) : "";
  const url = header?.titleAction ?? "";
  const iconUrl = header?.icon ?? "";

  if (!iframe?.url) {
    return (
      <div className={`frosted rounded-xl p-4 flex items-center justify-center text-sm opacity-50 ${className}`}>
        No URL provided for IFrame
      </div>
    );
  }

  return (
    <div className={`frosted rounded-xl overflow-hidden flex flex-col ${className}`}>
      {(title || iconUrl) && (
        <a
          href={url || "#"}
          className="font-medium p-3 flex w-full text-start items-center gap-2 border-b border-white/5"
        >
          <AppIcon
            source={iconUrl}
            className={`h-4 w-4 ${iconUrl ? "" : "invisible"}`}
            alt=""
            size={16}
          />
          <p className="font-semibold truncate flex-1">{title}</p>
          {url && url !== "#" && (
            <Icon
              icon="fa6-solid:up-right-from-square"
              className="text-xs hover:text-primary transition-colors"
            />
          )}
        </a>
      )}
      <div className="w-full flex-1 min-h-0">
        <iframe
          src={iframe.url}
          className="w-full border-none bg-white"
          style={{
            minHeight: iframe.minHeight ? `${iframe.minHeight}px` : "300px",
            maxHeight: iframe.maxHeight ? `${iframe.maxHeight}px` : "none",
            height: "100%",
          }}
          title={typeof title === "string" ? title : "IFrame Content"}
        />
      </div>
    </div>
  );
}
