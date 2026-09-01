"use client";

import { useEffect, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import WidgetColumnTemplate from "@dashwise/integrationskit/templates/WidgetColumn";
import useAuth from "@/context/useAuth";
import { executeSearchItemAction, logSearchItemUsageAction, proxyIntegrationAction, getSearchItemsAction } from "@/lib/apiClient";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useSearchItemsLive } from "@/hooks/useSearchItemsLive";
import { queryKeys } from "@/lib/queryClient";
import { applyStatefulShortcutAction, parseStatefulShortcutAction, type ShortcutState } from "@dashwise/types";

type Shortcut = { id: string; name: string; icon?: string; action: string | { type: string; url?: string }; states?: ShortcutState[] };

export default function ShortcutsWidget({ shortcutIds = [], className = "" }: { shortcutIds?: string[]; className?: string }) {
  const { withAuth, toggleTheme, toggleLinkTileLayout } = useAuth();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const searchItemsQuery = useApiQuery(queryKeys.links.search, getSearchItemsAction);
  const { sendStatefulAction } = useSearchItemsLive();

  useEffect(() => {
    let cancelled = false;
    const items = searchItemsQuery.data;
    if (Array.isArray(items)) {
      const selected = new Map((items as Shortcut[]).map((item) => [item.id, item]));
      setShortcuts(shortcutIds.map((id) => selected.get(id)).filter((item): item is Shortcut => Boolean(item)));
    } else if (!cancelled && searchItemsQuery.isError) {
      setShortcuts([]);
    }
    return () => { cancelled = true; };
  }, [shortcutIds, searchItemsQuery.data, searchItemsQuery.isError]);

  const runShortcut = async (shortcut: Shortcut) => {
    const action = shortcut.action;
    if (typeof action === "string") {
      const statefulAction = parseStatefulShortcutAction(action);
      if (statefulAction) {
        const previous = shortcut.states || [];
        const next = applyStatefulShortcutAction(previous, statefulAction);
        setShortcuts((current) => current.map((item) => item.id === shortcut.id ? { ...item, states: next } : item));
        try {
          await withAuth((auth) => sendStatefulAction(shortcut.id, action) || executeSearchItemAction(auth, shortcut.id, action));
          void withAuth((auth) => logSearchItemUsageAction(auth, shortcut.id, new Date().toISOString()));
        } catch {
          setShortcuts((current) => current.map((item) => item.id === shortcut.id ? { ...item, states: previous } : item));
        }
        return;
      }
    }
    if (typeof action === "object" && action.type.toLowerCase() === "post") {
      await withAuth((auth) => proxyIntegrationAction(auth, shortcut.id));
      return;
    }
    const value = typeof action === "string" ? action.trim() : String(action.url ?? "").trim();
    if (!value) return;
    if (value.toLowerCase().startsWith("theme:")) {
      await toggleTheme();
      void withAuth((auth) => logSearchItemUsageAction(auth, shortcut.id, new Date().toISOString()));
      return;
    }
    if (value.toLowerCase().startsWith("link-tile-layout:")) {
      await toggleLinkTileLayout();
      void withAuth((auth) => logSearchItemUsageAction(auth, shortcut.id, new Date().toISOString()));
      return;
    }
    if (value.startsWith("command:")) {
      window.location.href = value.startsWith("command://") ? value : value.replace("command:", "client://");
      return;
    }
    window.open(value.startsWith("url:") ? value.slice(4) : value, "_self");
    void withAuth((auth) => logSearchItemUsageAction(auth, shortcut.id, new Date().toISOString()));
  };

  return <WidgetColumnTemplate className={className} title="Shortcuts">
    <div className="flex snap-x justify-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {shortcuts.length ? shortcuts.map((shortcut) => <button key={shortcut.id} type="button" onClick={() => void runShortcut(shortcut)} className="flex min-w-16 snap-start flex-col items-center gap-1 rounded-md p-1 text-center transition-colors hover:bg-white/10">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10"><AppIcon source={shortcut.icon ?? ""} alt="" size={22} /></span>
        <span className="w-full truncate text-xs text-foreground">{shortcut.name}</span>
        {shortcut.states?.length ? <span className="w-full truncate text-[10px] text-white/50">{shortcut.states.map((state) => `${state.name}: ${String(state.value ?? "—")}`).join(" · ")}</span> : null}
      </button>) : <p className="w-full text-xs text-white/50">Select shortcuts in widget settings.</p>}
    </div>
  </WidgetColumnTemplate>;
}
