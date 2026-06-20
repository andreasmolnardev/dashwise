"use client";

import React from "react";
import VerticalList from "../templates/VerticalList";

interface WidgetItemProps {
  className?: string;
}

export interface RssFeedItem {
  title?: string;
  link?: string;
  pubDate?: string | Date;
  subscription_name?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  enclosure?: { url?: string };
  [key: string]: unknown;
}

export interface RssFeedWidgetProps extends WidgetItemProps {
  items?: RssFeedItem[];
  maxItems?: number;
  title?: string;
}

export default function RssFeedWidget({
  items = [],
  maxItems = 8,
  title = "Latest Articles",
  className = "",
}: RssFeedWidgetProps) {
  const latest = items.slice(0, maxItems);

  const resolved = {
    header: {
      title,
      show: true,
      icon: "fa6-solid:rss",
    },
    list: latest.map((item) => ({
      title: item.title || "Untitled",
      titleAction: item.link || undefined,
      subtitle: [
        item.subscription_name,
        formatDate(item.pubDate),
      ].filter(Boolean) as string[],
      thumbnail: getThumbnail(item),
      icon: "fa6-solid:rss",
    })),
    raw: {},
  };

  return <VerticalList resolved={resolved} className={className} itemClassName="gap-1" />;
}

function formatDate(value?: string | Date) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getThumbnail(item: RssFeedItem) {
  if (typeof item.thumbnail === "string" && item.thumbnail.trim()) {
    return item.thumbnail;
  }

  if (typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()) {
    return item.thumbnailUrl;
  }

  if (item.enclosure && typeof item.enclosure.url === "string") {
    return item.enclosure.url;
  }

  return undefined;
}
