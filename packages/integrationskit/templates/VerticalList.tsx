"use client";

import { Icon } from "@iconify-icon/react";
import React from "react";
import AppIcon from "@dashwise/app-icon";
import type { ResolvedWidget } from "../data/resolveProperties";
import { renderLocalizedText, type TextFormatters } from "../data/renderText";

interface VerticalListProps {
  resolved: ResolvedWidget;
  className?: string;
  formatters?: TextFormatters;
}

export default function VerticalList({ resolved, className, formatters }: VerticalListProps) {
  const header = resolved.header;
  const items = resolved.list ?? [];

  return (
    <div className={`rounded-lg p-2 flex-col ${className ?? ""}`}>
      {header?.show !== false && header?.title && (
        <a
          href={header.titleAction ?? "#"}
          className="font-medium mb-1 grid grid-cols-[18px_1fr_16px] w-full text-start items-center gap-2"
        >
          <AppIcon source={header.icon} className="h-4 mx-0.5" alt="" size={16} />
          <p className="font-semibold truncate">{renderLocalizedText(header.title, formatters)}</p>
          {header.titleAction && (
            <Icon
              icon="fa6-solid:up-right-from-square"
              className="text-xs hover:text-primary"
            />
          )}
        </a>
      )}

      <ul className="flex flex-col gap-1 overflow-y-auto max-h-64 scrollbar-hidden">
        {items.map((item, i) => (
          <ListRow key={i} item={item} />
        ))}

        {items.length === 0 && (
          <li className="text-sm opacity-50 py-2 text-center">No items</li>
        )}
      </ul>
    </div>
  );
}

function ListRow({
  item,
}: {
  item: NonNullable<ResolvedWidget["list"]>[number];
}) {
  const subtitleLines = Array.isArray(item.subtitle)
    ? item.subtitle
    : item.subtitle
    ? [item.subtitle]
    : [];

  return (
    <li
      className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
      style={
        item.accent
          ? { borderLeft: `3px solid ${item.accent}`, paddingLeft: 8 }
          : { borderLeft: "3px solid transparent", paddingLeft: 8 }
      }
    >
      {/* Thumbnail / icon */}
      {item.thumbnail && !item.thumbnail.includes("placeholder") ? (
        <img
          src={item.thumbnail}
          alt=""
          className="h-8 w-8 rounded object-cover shrink-0"
        />
      ) : item.icon ? (
        <span className="h-8 w-8 flex items-center justify-center shrink-0 text-base">
          <AppIcon source={item.icon} className="h-5 w-5 object-contain" alt="" size={20} />
        </span>
      ) : null}

      {/* Text block */}
      <div className="flex-1 min-w-0">
        {item.title && (
          item.titleAction ? (
            <a
              href={item.titleAction}
              className="block text-sm font-medium truncate hover:text-primary transition-colors"
            >
              {renderLocalizedText(item.title, formatters)}
            </a>
          ) : (
            <p className="text-sm font-medium truncate">{renderLocalizedText(item.title, formatters)}</p>
          )
        )}

        {subtitleLines.length > 0 && (
          <p className="text-xs opacity-60 truncate leading-snug">
            {renderLocalizedText(subtitleLines, formatters)}
          </p>
        )}
      </div>

      {/* External link indicator */}
      {item.titleAction && (
        <Icon
          icon="fa6-solid:up-right-from-square"
          className="text-[10px] opacity-40 hover:opacity-80 shrink-0 transition-opacity"
        />
      )}
    </li>
  );
}
