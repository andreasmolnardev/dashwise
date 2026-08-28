"use client";

import { useEffect, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import WidgetColumnTemplate from "@dashwise/integrationskit/templates/WidgetColumn";
import useAuth from "@/context/useAuth";
import { getShortcutsAction, logShortcutUsageAction, proxyIntegrationAction } from "@/lib/apiClient";

type Shortcut = { id: string; name: string; icon?: string; action: string | { type: string; url?: string } };

export default function ShortcutsWidget({ shortcutIds = [], className = "" }: { shortcutIds?: string[]; className?: string }) {
  const { withAuth, toggleTheme, toggleLinkTileLayout } = useAuth();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);

  useEffect(() => {
    let cancelled = false;
    void withAuth((auth) => getShortcutsAction(auth)).then((items) => {
      if (cancelled || !Array.isArray(items)) return;
      const selected = new Map((items as Shortcut[]).map((item) => [item.id, item]));
      setShortcuts(shortcutIds.map((id) => selected.get(id)).filter((item): item is Shortcut => Boolean(item)));
    }).catch(() => { if (!cancelled) setShortcuts([]); });
    return () => { cancelled = true; };
  }, [shortcutIds, withAuth]);

  const runShortcut = async (shortcut: Shortcut) => {
    const action = shortcut.action;
    if (typeof action === "object" && action.type.toLowerCase() === "post") {
      await withAuth((auth) => proxyIntegrationAction(auth, shortcut.id));
      return;
    }
    const value = typeof action === "string" ? action.trim() : String(action.url ?? "").trim();
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
