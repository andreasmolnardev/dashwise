"use client";

import { useEffect, useMemo, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import WidgetColumnTemplate from "@dashwise/integrationskit/templates/WidgetColumn";
import useAuth from "@/context/useAuth";
import { getHomeLinksAction, logShortcutUsageAction, proxyIntegrationAction } from "@/lib/apiClient";
import { getRoutedLinkUrl } from "@/lib/linkRouting";
import { useResourceView } from "@/hooks/useResourceView";
import type { ViewResourceQuery } from "@/lib/viewsApi";

type Shortcut = { id: string; name: string; icon?: string; sourceId?: string; action: string | { type: string; url?: string } };

export default function ShortcutsWidget({ shortcutIds = [], className = "" }: { shortcutIds?: string[]; className?: string }) {
  const { withAuth, toggleTheme, toggleLinkTileLayout } = useAuth();
  const [homeLinks, setHomeLinks] = useState<Array<{ id: string; url: string; secondaryUrls?: Array<{ url: string; routingRule: string }> }>>([]);
  const query = useMemo<ViewResourceQuery>(() => ({
    types: ["dashwise.shortcut"],
    provider: "dashwise",
    providerInstanceId: "shortcuts",
    capabilities: [],
    filters: [{ field: "kind", operator: "eq", value: "shortcut" }],
    search: "",
    orderBy: "updatedAt",
    limit: 200,
    offset: 0,
  }), []);
  const resourceView = useResourceView(query);
  const shortcuts = useMemo<Shortcut[]>(() => {
    const selected = new Map<string, Shortcut>((resourceView.data?.items ?? []).map((resource) => {
      const data = resource.data;
      const shortcut: Shortcut = {
        id: resource.providerResourceId,
        name: textValue(data.name) || textValue(data.title),
        icon: textValue(data.icon) || undefined,
        sourceId: textValue(data.sourceId) || undefined,
        action: (data.action ?? "") as Shortcut["action"],
      };
      return [resource.providerResourceId, shortcut];
    }));
    return shortcutIds.map((id) => selected.get(id)).filter((item): item is Shortcut => item !== undefined);
  }, [resourceView.data, shortcutIds]);

  useEffect(() => {
    let cancelled = false;
    void withAuth((auth) => getHomeLinksAction(auth)).then((links) => {
      if (cancelled) return;
      setHomeLinks(Array.isArray(links) ? links as typeof homeLinks : []);
    }).catch(() => { if (!cancelled) setHomeLinks([]); });
    return () => { cancelled = true; };
  }, [withAuth]);

  const runShortcut = async (shortcut: Shortcut) => {
    const action = shortcut.action;
    if (typeof action === "object" && action.type.toLowerCase() === "post") {
      await withAuth((auth) => proxyIntegrationAction(auth, shortcut.id));
      return;
    }
    const sourceLink = shortcut.sourceId && homeLinks.find((link) => link.id === shortcut.sourceId);
    const value = action === "link" && sourceLink
      ? getRoutedLinkUrl(sourceLink)
      : typeof action === "string" ? action.trim() : String(action.url ?? "").trim();
    if (!value) return;
    if (value.toLowerCase().startsWith("theme:")) {
      await toggleTheme();
      void withAuth((auth) => logShortcutUsageAction(auth, shortcut.id, new Date().toISOString()));
      return;
    }
    if (value.toLowerCase().startsWith("link-tile-layout:")) {
      await toggleLinkTileLayout();
      void withAuth((auth) => logShortcutUsageAction(auth, shortcut.id, new Date().toISOString()));
      return;
    }
    if (value.toLowerCase().startsWith("shortcut:")) {
      await withAuth((auth) => proxyIntegrationAction(auth, shortcut.id));
      return;
    }
    if (value.startsWith("command:")) {
      window.location.href = value.startsWith("command://") ? value : value.replace("command:", "client://");
      return;
    }
    window.open(value.startsWith("url:") ? value.slice(4) : value, "_self");
    void withAuth((auth) => logShortcutUsageAction(auth, shortcut.id, new Date().toISOString()));
  };

  return <WidgetColumnTemplate className={className} title="Shortcuts">
    <div className="flex snap-x justify-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {shortcuts.length ? shortcuts.map((shortcut) => <button key={shortcut.id} type="button" onClick={() => void runShortcut(shortcut)} className="flex min-w-16 snap-start flex-col items-center gap-1 rounded-md p-1 text-center transition-colors hover:bg-white/10">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10"><AppIcon source={shortcut.icon ?? ""} alt="" size={22} /></span>
        <span className="w-full truncate text-xs text-foreground">{shortcut.name}</span>
      </button>) : <p className="w-full text-xs text-white/50">Select shortcuts in widget settings.</p>}
    </div>
  </WidgetColumnTemplate>;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
