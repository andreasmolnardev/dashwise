'use client';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import useAuth, { COMMAND_BAR_OPEN_EVENT } from "@/context/useAuth";
import { useActivity } from "@/context/ActivityContext";
import { useResourceView } from "@/hooks/useResourceView";
import type { ViewResourceQuery } from "@/lib/viewsApi";
import { getSdkShortcutResourceIdentities } from "@/lib/sdkShortcutResources";

const CommandBar = lazy(() => import('./CommandBar'));

type SearchBarProps = {
  useRedirect: boolean;
  defaultOpen?: boolean;
  showTrigger?: boolean;
  enableGlobalShortcut?: boolean;
};

type ProxyAction = {
  type: string;
  url?: string;
  proxy?: boolean;
  instanceId?: string;
  collectionId?: string;
  resourceId?: string;
};

type Shortcut = {
  id?: string;
  parentId?: string;
  name: string;
  icon: string;
  secondaryInfo: string;
  type: string;
  integrationName?: string;
  action: string | ProxyAction;
  actions?: Record<string, string>;
  secondaryActions?: Record<string, string>;
  isDisabled?: boolean;
  tags?: string[];
};

export default function SearchBar({
  useRedirect,
  defaultOpen,
  showTrigger = true,
  enableGlobalShortcut = false,
}: SearchBarProps) {
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    if (defaultOpen) window.dispatchEvent(new Event(COMMAND_BAR_OPEN_EVENT));
  }, [defaultOpen]);

  const handleFocus = () => {
    if (useRedirect) setRedirecting(true);
    window.dispatchEvent(new Event(COMMAND_BAR_OPEN_EVENT));
  };

  return (
    <>
      {showTrigger && (
        <div
          className={`flex items-center justify-center border frosted rounded-lg
            focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500
            transition-transform duration-300 ${redirecting ? 'scale-105 opacity-70' : 'scale-100 opacity-100'}`}
        >
          <input
            type="text"
            data-slot="input"
            className="w-full bg-transparent px-3 py-2 text-[0.875rem] font-medium text-gray dark:text-white placeholder-(--text-on-frosted) hover:placeholder-(--text-color)
                   focus:outline-none"
            placeholder="Search..."
            onFocus={handleFocus}
          />
        </div>
      )}

      {enableGlobalShortcut && <CommandBarHost />}
    </>
  );
}

/** One authenticated host; dashboard search widgets only dispatch open events. */
function CommandBarHost() {
  const [{ open, hasOpened }, setState] = useState({ open: false, hasOpened: false });
  const { token, user } = useAuth();
  const { subscribeSdkResources } = useActivity();
  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    setState((previous) => {
      const open = typeof next === "function" ? next(previous.open) : next;
      return { open, hasOpened: previous.hasOpened || open };
    });
  }, []);
  const shortcutsViewQuery = useMemo<ViewResourceQuery>(() => ({
    types: ["dashwise.shortcut"],
    provider: "dashwise",
    providerInstanceId: "shortcuts",
    capabilities: [],
    filters: [],
    search: "",
    orderBy: "updatedAt",
    limit: 200,
    offset: 0,
  }), []);
  const shortcutsQuery = useResourceView(shortcutsViewQuery, open);
  const refetchShortcuts = shortcutsQuery.refetch;
  const shortcuts = useMemo<Shortcut[]>(() => (shortcutsQuery.data?.items ?? []).map((resource) => {
    const data = resource.data;
    return {
      id: resource.providerResourceId,
      parentId: textValue(data.app) || undefined,
      name: textValue(data.name) || textValue(data.title),
      icon: textValue(data.icon),
      secondaryInfo: textValue(data.secondary),
      type: textValue(data.kind),
      action: (data.action ?? "") as Shortcut["action"],
      actions: objectValue(data.actions) as Record<string, string> | undefined,
      secondaryActions: objectValue(data.secondaryActions) as Record<string, string> | undefined,
      isDisabled: typeof data.isDisabled === "boolean" ? data.isDisabled : undefined,
      tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    };
  }), [shortcutsQuery.data]);
  const sdkResources = useMemo(() => getSdkShortcutResourceIdentities(shortcuts), [shortcuts]);
  const sdkResourceSignature = JSON.stringify(sdkResources);
  const stableSdkResources = useRef({ signature: sdkResourceSignature, resources: sdkResources });
  if (stableSdkResources.current.signature !== sdkResourceSignature) {
    stableSdkResources.current = { signature: sdkResourceSignature, resources: sdkResources };
  }
  const subscribedSdkResources = stableSdkResources.current.resources;
  const pendingShortcutRefresh = useRef<number | null>(null);

  useEffect(() => {
    if (!open || subscribedSdkResources.length === 0) return;
    const unsubscribe = subscribeSdkResources(subscribedSdkResources, () => {
      // A subscription sends an initial revision for every resource. Batch those
      // messages, and live bursts, into one shortcut refresh instead of starting
      // a separate full fetch for each resource.
      if (pendingShortcutRefresh.current !== null) {
        window.clearTimeout(pendingShortcutRefresh.current);
      }
      pendingShortcutRefresh.current = window.setTimeout(() => {
        pendingShortcutRefresh.current = null;
        void refetchShortcuts();
      }, 100);
    });
    return () => {
      unsubscribe();
      if (pendingShortcutRefresh.current !== null) {
        window.clearTimeout(pendingShortcutRefresh.current);
        pendingShortcutRefresh.current = null;
      }
    };
  }, [open, refetchShortcuts, subscribedSdkResources, subscribeSdkResources]);

  useLayoutEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!event.repeat && !event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    const handleOpen = () => setOpen(true);
    window.addEventListener("keydown", handleKey);
    window.addEventListener(COMMAND_BAR_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(COMMAND_BAR_OPEN_EVENT, handleOpen);
    };
  }, [setOpen]);

  // Keep action dialogs alive after closing search, but never load them at startup.
  return hasOpened ? (
    <Suspense fallback={open ? <div role="status" className="fixed left-1/2 top-1/4 z-50 -translate-x-1/2 rounded-lg frosted p-4 text-sm">Loading search…</div> : null}>
      <CommandBar key={token} open={open} setOpen={setOpen} shortcuts={shortcuts} config={user?.searchPreferences ?? {}} />
    </Suspense>
  ) : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
