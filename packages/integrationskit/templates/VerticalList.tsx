"use client";

import { Icon } from "@iconify-icon/react";
import React from "react";
import AppIcon from "@dashwise/app-icon";
import type { ResolvedWidget } from "../types";
import { renderLocalizedText, type TextFormatters } from "../data/renderText";

interface VerticalListProps {
  resolved: ResolvedWidget;
  className?: string;
  formatters?: TextFormatters;
}

export default function VerticalList(
  { resolved, className, formatters }: VerticalListProps,
) {
  const header = resolved.header;
  const items = resolved.list ?? [];

  return (
    <div className={`frosted rounded-xl p-2 flex-col ${className ?? ""}`}>
      {header?.show !== false && header?.title && (
        <a
          href={header.titleAction ?? "#"}
          className="font-medium mb-1 flex w-full text-start items-center gap-1 pl-1"
        >
          <AppIcon
            source={header.icon}
            className="h-4 mx-0.5 mb-0.1"
            alt=""
            size={16}
          />
          <p className="font-semibold truncate">
            {renderLocalizedText(header.title, formatters)}
          </p>
          {header.titleAction && (
            <Icon
              icon="fa6-solid:up-right-from-square"
              className="text-xs hover:text-primary"
            />
          )}
        </a>
      )}

      <ul className="overflow-y-auto max-h-64 scrollbar-hidden">
        {(() => {
          if (items.some(item => item.group)) {
            const groups: { label: string; items: typeof items }[] = [];
            items.forEach(item => {
              const groupLabel = item.group || "";
              let group = groups.find(g => g.label === groupLabel);
              if (!group) {
                group = { label: groupLabel, items: [] };
                groups.push(group);
              }
              group.items.push(item);
            });

            return groups.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-0.5 py-0.5 px-1">
                {group.label && (
                  <div className="text-sm font-bold">
                    {group.label}
                  </div>
                )}
                {group.items.map((item, i) => (
                  <ListRow key={i} item={item} formatters={formatters} className="p-1"/>
                ))}
              </div>
            ));
          }

          return items.map((item, i) => (
            <ListRow key={i} item={item} formatters={formatters} />
          ));
        })()}

        {items.length === 0 && (
          <li className="text-sm opacity-50 py-2 text-center">No items</li>
        )}
      </ul>
    </div>
  );
}

function ListRow({
  item,
  formatters,
  className,
}: {
  item: NonNullable<ResolvedWidget["list"]>[number];
  formatters?: TextFormatters;
  className?: string;
}) {
  const subtitleLines = Array.isArray(item.subtitle)
    ? item.subtitle
    : item.subtitle
      ? [item.subtitle]
      : [];

  return (
    <li
      className={`flex items-center gap-2.5 rounded-md hover:bg-white/5 transition-colors ${className}`}
    >
      {/* Thumbnail / icon */}
      {item.thumbnail && !item.thumbnail.includes("placeholder")
        ? (
          <img
            src={item.thumbnail}
            alt=""
            className="h-8 w-8 rounded object-cover shrink-0"
          />
        )
        : item.icon
          ? (
            <span className="h-8 w-8 flex items-center justify-center shrink-0 text-base">
              <AppIcon
                source={item.icon}
                className="h-5 w-5 object-contain"
                alt=""
                size={20}
              />
            </span>
          )
          : null}

      {/* Text block */}
      <div className="flex-1 min-w-0">
        {item.title && (
          item.titleAction
            ? (
              <a
                href={item.titleAction}
                className="block font-medium truncate hover:text-primary transition-colors"
              >
                {renderLocalizedText(item.title, formatters)}
              </a>
            )
            : (
              <p className="font-medium truncate">
                {renderLocalizedText(item.title, formatters)}
              </p>
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
