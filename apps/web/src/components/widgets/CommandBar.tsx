import React from "react";
import type { SyntheticEvent } from "react";

import { Dialog, DialogContent } from "../ui/dialog";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";
import { Separator } from "../ui/separator";
import { DialogTitle } from "@radix-ui/react-dialog";
import { Icon as IconifyIcon } from "@iconify-icon/react";
import AppIcon from "@dashwise/app-icon";
import QRCode from "qrcode";
import { getFrequentlyUsedSearchItemsAction, logSearchItemUsageAction } from "@/app/actions/searchItems";

// --- Types ---

type LinkItem = {
  id?: string;
  parentId?: string;
  icon?: string;
  linkGroup?: string;
  type?: string;
  name: string;
  url: string;
  tags?: string[];
  isBangAction?: boolean;
  bangEngineSlug?: string;
  bangEngineName?: string;
  isSearchEngine?: boolean;
  engineSlug?: string;
  isQrAction?: boolean;
  isPinned?: boolean;
  _section?: string;
};

type SearchEngine = {
  icon?: string;
  name?: string;
  slug?: string;
  bang?: string;
  status?: string;
  url_home?: string;
  url_params?: string;
};

type IncomingSearchItem = {
  id?: string;
  parentId?: string;
  name?: string;
  icon?: string;
  secondaryInfo?: string;
  type?: string;
  action?: string;
  url?: string;
  linkGroup?: string;
  tags?: string[];
  isPinned?: boolean;
};

type CommandBarProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchItems: IncomingSearchItem[];
  config: Record<string, any>;
};

function normalizeConfigLinks(input: IncomingSearchItem[] = []): LinkItem[] {
  return input
    .filter((it) =>
      !it.type || it.type === "link" || it.type === "app" ||
      it.type === "karakeepBookmark" || it.type === "jellyfinItem" ||
      it.type === "beszelItem" || it.type === "dashdotItem"
    )
    .map((it) => {
      const action = (it.action || "").toString().trim();
      let url = "";

      if (action.startsWith("url:")) {
        url = action.slice(4);
      } else if (action.startsWith("command:")) {
        url = action; // keep command: prefix
      } else {
        url = action || (it.url || "");
      }

      let type;

      if (it.type === "karakeepBookmark") {
        type = "Karakeep";
      } else if (it.type === "jellyfinItem") {
        type = "Jellyfin";
      } else if (it.type === "app") {
        type = "App";
      } else if (it.type === "beszelItem") {
        type = "Beszel";
      } else if (it.type === "dashdotItem") {
        type = "Dashdot";
      } else {
        type = "Link";
      }

      return {
        id: it.id,
        parentId: (it as any).parentId,
        name: it.name || "",
        icon: it.icon || undefined,
        linkGroup: it.secondaryInfo || it.linkGroup || "",
        tags: it.tags || "",
        type,
        url,
        isPinned: it.isPinned,
      } as LinkItem;
    });
}

export default function CommandBar(
  { open, setOpen, searchItems, config }: CommandBarProps,
) {
  const { user, token } = useAuth();
  const searchPreferences = user?.searchPreferences ?? {};
  const searchEngines: SearchEngine[] =
    (searchPreferences.searchEngines || []) as SearchEngine[];

  const links: LinkItem[] = React.useMemo(
    () => normalizeConfigLinks(searchItems || []),
    [searchItems],
  );

  const defaultEngine = searchEngines.find((se) => se.status === "default") ||
    searchEngines.find((se) => se.status !== "disabled") ||
    searchEngines[0];

  const [clipboardText, setClipboardText] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [filtered, setFiltered] = React.useState<LinkItem[]>(links);
  const [currentAppId, setCurrentAppId] = React.useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = React.useState(0);
  const [qrCodeDataUrl, setQrCodeDataUrl] = React.useState("");
  const [qrCodeLoading, setQrCodeLoading] = React.useState(false);
  const [qrCodeError, setQrCodeError] = React.useState<string | null>(null);
  const [frequentlyUsedIds, setFrequentlyUsedIds] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Fetch frequently used items
  React.useEffect(() => {
    if (!user?.id || !token) {
      return;
    }

    void getFrequentlyUsedSearchItemsAction({ token })
      .then((data) => {
        if (Array.isArray(data)) {
          setFrequentlyUsedIds(data.map((item: any) => item.id));
        }
      })
      .catch(() => {
        // ignore failures
      });
  }, [user?.id, token]);

  // Ref for the scrollable list container
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Refs for each action item
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // open/close dialog
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      try {
        navigator.clipboard?.readText?.().then((text) => {
          if (text && text.trim().length > 0) {
            setClipboardText(text.trim());
          }
        }).catch(() => {/* ignore */});
      } catch (e) { /* ignore */ }
    } else {
      setQuery("");
      setFiltered(links);
      setCurrentAppId(null);
      setHighlightIndex(0);
      setClipboardText("");
    }
  }, [open, links]);

  //item filtering
  React.useEffect(() => {
    const visibleLinks = currentAppId
      ? links.filter((item) => item.parentId === currentAppId)
      : links.filter((item) => !item.parentId);

    const q = query.trim().toLowerCase();
    if (!q) {
      // Group: Pinned, Frequently Used, others
      const pinned = visibleLinks.filter((l) => l.isPinned);
      const frequentlyUsed = visibleLinks.filter(
        (l) => !l.isPinned && l.id && frequentlyUsedIds.includes(l.id)
      );
      const others = visibleLinks.filter(
        (l) => !l.isPinned && (!l.id || !frequentlyUsedIds.includes(l.id))
      );

      // We'll mark them with a transient section name for rendering
      const grouped = [
        ...pinned.map((l) => ({ ...l, _section: "Pinned" })),
        ...frequentlyUsed.map((l) => ({ ...l, _section: "Frequently Used" })),
        ...others.map((l) => ({ ...l, _section: "All" })),
      ];

      setFiltered(grouped);
      setHighlightIndex(0);
      return;
    }

    const minMatchRatio = 0.5;
    const matchMode = "prefix";

    const queryWords = q.split(/\s+/).filter(Boolean);

    const results = visibleLinks
      .map((item) => {
        // turn tags into words: split on non-word chars so "foo-bar" -> ["foo","bar"]
        const tagWords = (item.tags || [])
          .flatMap((t) => String(t).toLowerCase().split(/\W+/).filter(Boolean));

        // for each query word, find if it matches any tag word (count each query word at most once)
        let matchedQueryCount = 0;
        for (const qw of queryWords) {
          const matched = tagWords.some((tw) => {
            //if (matchMode === 'whole') return tw === qw;
            if (matchMode === "prefix") return tw.startsWith(qw);
            return tw === qw;
          });
          if (matched) matchedQueryCount += 1;
        }

        const matchRatio = queryWords.length > 0
          ? matchedQueryCount / queryWords.length
          : 0;

        return { item, matchedQueryCount, matchRatio };
      })
      // drop weak matches below the threshold
      .filter(({ matchRatio }) => matchRatio >= minMatchRatio)
      // sort descending by ratio, then by raw matched count
      .sort((a, b) => {
        if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
        return b.matchedQueryCount - a.matchedQueryCount;
      })
      .map(({ item }) => item);

    setFiltered(results);
    setHighlightIndex(0);
  }, [query, links, currentAppId, frequentlyUsedIds]);

  const normalizedUrl = React.useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || currentAppId || !isValidUrl(trimmedQuery)) {
      return "";
    }

    return trimmedQuery.startsWith("http")
      ? trimmedQuery
      : `https://${trimmedQuery}`;
  }, [currentAppId, query]);

  React.useEffect(() => {
    if (!normalizedUrl) {
      setQrCodeDataUrl("");
      setQrCodeLoading(false);
      setQrCodeError(null);
      return;
    }

    let cancelled = false;

    setQrCodeLoading(true);
    setQrCodeError(null);

    void QRCode.toDataURL(normalizedUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 8,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setQrCodeError(
            error instanceof Error ? error.message : String(error),
          );
          setQrCodeDataUrl("");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setQrCodeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedUrl]);

  // open on cmd/ctrl + k
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setOpen]);

  // parse bang: returns {slug, rest} or null
  const parseBang = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return null;

    const leadingMatch = trimmed.match(/^!(\w+)\s*(.*)$/s);
    if (leadingMatch) {
      return {
        slug: leadingMatch[1].toLowerCase(),
        rest: (leadingMatch[2] || "").trim(),
      };
    }

    const trailingMatch = trimmed.match(/^(.*\S)\s*!([A-Za-z0-9_]+)\s*$/s);
    if (trailingMatch) {
      return {
        slug: trailingMatch[2].toLowerCase(),
        rest: (trailingMatch[1] || "").trim(),
      };
    }

    return null;
  };

  // build actions; if a valid bang is present, add a bang action at the top, or advertise "go to url"
  const actions = React.useMemo(() => {
    const items = [...filtered];

    const trimmedQuery = query.trim();

    if (currentAppId) {
      items.unshift({
        id: "__app_back__",
        name: "Back",
        url: "__app_back__",
        icon: "fa6-solid:arrow-left",
        linkGroup: "Dashwise",
        type: "App",
      } as LinkItem);
    }

    // --- 1. Go to URL (only if valid URL) ---
    if (!currentAppId && isValidUrl(trimmedQuery)) {
      items.unshift({
        name: `Go to ${trimmedQuery}`,
        url: trimmedQuery.startsWith("http")
          ? trimmedQuery
          : `https://${trimmedQuery}`,
        icon: "/icons/faGlobe.svg", // globe icon
        linkGroup: "URL",
        type: "Go to URL",
      } as LinkItem);

      items.splice(1, 0, {
        name: `Generate QR code for ${trimmedQuery}`,
        url: "__qr_action__",
        icon: "fa6-solid:qrcode",
        linkGroup: "URL",
        type: "QR Code",
        isQrAction: true,
      } as LinkItem);
    }

    // --- 2. Bang search ---
    const parsed = parseBang(trimmedQuery);
    if (!currentAppId && parsed) {
      const engine = searchEngines.find((se) =>
        (se.slug || "").toLowerCase() === parsed.slug
      );
      const fallbackEngine = searchEngines.find((se) =>
        (se.slug || "").toLowerCase() ==
          searchPreferences.searchEngineShortcutFallback
      );
      if (engine) {
        items.unshift({
          name: `Search with ${engine.name} (${
            engine.slug ? "!" + engine.slug : ""
          })`,
          url: "__bang_search__",
          icon: engine.icon,
          linkGroup: engine.name,
          isBangAction: true,
          bangEngineSlug: engine.slug,
          bangEngineName: engine.name,
        } as LinkItem);
      } else if (fallbackEngine) {
        items.unshift({
          name: `Forward shortcut to ${fallbackEngine?.name}`,
          url: "__forward_search__",
          icon: fallbackEngine?.icon,
          linkGroup: "Dashwise",
          isBangAction: true,
          bangEngineSlug: fallbackEngine?.slug,
          bangEngineName: fallbackEngine?.name,
        } as LinkItem);
      }
    }

    // --- 3. Default search engine (only once) ---
    if (
      !currentAppId &&
      (!parsed ||
        !searchEngines.find((se) =>
          (se.slug || "").toLowerCase() === parsed.slug
        ))
    ) {
      items.push({
        name: `Search ${defaultEngine?.name || "web"}`,
        url: "__search_action__",
        icon: defaultEngine?.icon,
        linkGroup: defaultEngine?.name || "web",
        type: "Search",
      } as LinkItem);
    }

    // --- 4. All other engines except default ---
    (!currentAppId ? (searchEngines || []) : [])
      .filter((se) =>
        (se.status || "").toLowerCase() !== "disabled" &&
        se.slug !== defaultEngine?.slug
      )
      .forEach((se) => {
        items.push({
          name: `${se.name}${se.slug ? ` (!${se.slug})` : ""}`,
          url: `__engine_search__:${se.slug}`,
          icon: se.icon,
          linkGroup: se.name,
          type: "Search",
          isSearchEngine: true,
          engineSlug: se.slug,
        } as LinkItem);
      });

    return items;
  }, [filtered, defaultEngine, query, searchEngines]);

  const selectedAction = actions[highlightIndex];
  const showQrPreview = Boolean(
    selectedAction?.url === "__qr_action__" || selectedAction?.isQrAction,
  );

  // Keep itemRefs array length in sync with actions length
  React.useEffect(() => {
    itemRefs.current = new Array(actions.length).fill(null);
  }, [actions.length]);

  // Scroll the highlighted item into view as the last visible item
  React.useEffect(() => {
    const el = itemRefs.current[highlightIndex];
    if (!el || !listRef.current) return;

    try {
      el.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest",
      });
    } catch {
      el.scrollIntoView(false);
    }
  }, [highlightIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const actionsCount = actions.length;
    if (e.key === "Tab" && !query && clipboardText) {
      e.preventDefault();
      setQuery(clipboardText);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % actionsCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + actionsCount) % actionsCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      triggerAction(highlightIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  function triggerAction(index: number) {
    const a = actions[index];
    if (!a) return;

    if (a.url === "__app_back__") {
      setCurrentAppId(null);
      setQuery("");
    } else if (a.url?.startsWith("app:")) {
      const appId = a.url.slice(4);
      setCurrentAppId(appId || null);
      setQuery("");
      setHighlightIndex(0);
    } else if (a.url === "__bang_search__") {
      openBangSearch(query, a.bangEngineSlug);
    } else if (a.url === "__forward_search__") {
      openBangSearch(`!${a.bangEngineSlug + "" + query}`, a.bangEngineSlug);
    } else if (a.url === "__search_action__") {
      openSearch(query);
    } else if (a.url === "__qr_action__") {
      return;
    } else if (a.url.startsWith("__engine_search__:")) {
      const slug = a.url.split(":", 2)[1];
      openEngineSearch(slug, query);
    } else if (a.url.startsWith("command:")) {
      logSearchItemUsage(a);
      openCommandClient(a.url);
    } else {
      logSearchItemUsage(a);
      openUrl(a.url, config?.global?.linkOpenBehaviour);
    }
  }

  function logSearchItemUsage(item?: LinkItem) {
    if (!token || !item?.id) return;
    void logSearchItemUsageAction({ token }, item.id, new Date().toISOString()).catch(() => {});
  }

  function openUrl(
    url: string,
    method: "newtab" | "sametab" | null = "sametab",
  ) {
    if (!url) return;
    let target: "_self" | "_blank" = "_self";
    if (method === "newtab") {
      target = "_blank";
    }
    window.open(url, target);
    setOpen(false);
  }

  function openSearch(q: string) {
    const engine = defaultEngine;
    if (!engine) return;
    const template = engine.url_params || engine.url_home || "";
    const searchUrl = template.replace("%s", encodeURIComponent(q || ""));
    if (!searchUrl) return;
    openUrl(searchUrl, config?.global?.linkOpenBehaviour ?? "sametab");
  }

  function openBangSearch(q: string, slug?: string) {
    if (!slug) return;
    const parsed = parseBang(q);
    const terms = parsed ? parsed.rest : "";
    const engine = searchEngines.find((se) =>
      (se.slug || "").toLowerCase() === (slug || "").toLowerCase()
    );
    if (!engine) return;
    const template = engine.url_params || engine.url_home || "";
    const searchUrl = template.replace("%s", encodeURIComponent(terms || ""));
    if (!searchUrl) return;
    openUrl(searchUrl, config?.global?.linkOpenBehaviour ?? "sametab");
  }

  function openEngineSearch(slug?: string, q?: string) {
    if (!slug) return;
    const engine = searchEngines.find((se) =>
      (se.slug || "").toLowerCase() === (slug || "").toLowerCase()
    );
    if (!engine) return;
    const template = engine.url_params || engine.url_home || "";
    const searchUrl = template.replace(
      "%s",
      encodeURIComponent((q || "").trim()),
    );
    if (!searchUrl) return;
    openUrl(searchUrl, config?.global?.linkOpenBehaviour ?? "sametab");
  }

  function openCommandClient(url: string) {
    try {
      const schemeUrl = url.startsWith("command://")
        ? url
        : url.startsWith("command:")
        ? url.replace("command:", "client://")
        : url;
      window.location.href = schemeUrl;
    } catch {
      // noop
    } finally {
      setOpen(false);
    }
  }

  function onClickLink(e: SyntheticEvent, a: LinkItem) {
    e.preventDefault();
    const idx = actions.indexOf(a);
    triggerAction(idx);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="hidden">Search Bar</DialogTitle>
      <DialogContent className="min-w-[50vw] min-h-[50vh] mx-auto frosted backdrop-blur-md grid grid-rows-[auto_1fr_auto] rounded-lg p-0 shadow-lg text-foreground">
        <div>
          <div className="relative flex mx-3 mt-3 pt-1 items-center">
            <input
              ref={inputRef}
              value={query}
              type="search"
              name="dashwise-search"
              data-form-type="other"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={clipboardText && !query
                ? ""
                : "Search your links, integrations, or press Enter to search the web..."}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full flex-1 rounded border border-none bg-transparent focus:outline-none relative z-10"
              aria-label="Command search"
            />
            {!query && clipboardText && (
              <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none text-muted-foreground opacity-50 z-0">
                <span className="truncate max-w-[40vw]">{clipboardText}</span>
                <span className="ml-2 text-[10px] border border-muted-foreground/50 rounded px-1.5 py-0.5">
                  Tab
                </span>
              </div>
            )}
          </div>
          <Separator className="mt-2 bg-(--text-primary)/20" />
        </div>

        <div
          className={`grid min-h-0 gap-3 px-3 pb-3 ${
            showQrPreview
              ? "lg:grid-cols-[minmax(0,1fr)_14rem]"
              : "lg:grid-cols-1"
          }`}
        >
          <div ref={listRef} className="max-h-[35vh] overflow-auto">
            {actions.map((item, index) => {
              const isSearchAction = item.url === "__search_action__";
              const isBangAction = item.url === "__bang_search__" ||
                item.isBangAction;
              const isQrAction = item.url === "__qr_action__" ||
                item.isQrAction;
              const isCommand = !isSearchAction && !isBangAction &&
                item.url?.startsWith("command:");
              const isHighlighted = highlightIndex === index;

              const showSectionHeader = !query && item._section &&
                (index === 0 || actions[index - 1]?._section !== item._section);

              return (
                <React.Fragment key={item.url + item.name + index}>
                  {showSectionHeader && (
                    <div className="px-2 py-1 mt-1 text-xs font-semibold text-muted-foreground">
                      {item._section}
                    </div>
                  )}
                  <button
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    onClick={(e) => onClickLink(e, item)}
                    className={`w-full text-left px-2 py-2 flex items-center gap-3 rounded ${
                      isHighlighted
                        ? "bg-white/20 text-white"
                        : "hover:bg-white/10"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center bg-white/20`}
                    >
                    {item.icon
                      ? (
                        <AppIcon
                          source={item.icon}
                          size={16}
                          className="w-4 h-4"
                          imageClassName="w-4 h-4 object-contain"
                          iconClassName="text-sm"
                        />
                      )
                      : isQrAction
                      ? (
                        <IconifyIcon
                          icon="fa6-solid:qrcode"
                          className="text-xs"
                        />
                      )
                      : isValidUrl(item.url)
                      ? (
                        <IconifyIcon
                          icon="fa6-solid:globe"
                          className="text-xs"
                        />
                      )
                      : <div className="w-4 h-4 bg-gray-300 rounded-sm" />}
                  </div>
                  <div className="flex-1 flex items-center min-w-0">
                    <div className="flex-1 min-w-0 flex gap-2 items-center overflow-hidden">
                      <div className="text-sm font-medium truncate shrink min-w-0">
                        {item.name}
                      </div>

                      <span className="text-xs text-muted-foreground truncate shrink-0 max-w-[30%]">
                        {item.linkGroup || ""}
                      </span>
                    </div>

                    <div className="ml-3 text-xs text-muted-foreground whitespace-nowrap">
                      {isCommand
                        ? <span className="italic">use client</span>
                        : <span>{item.type}</span>}
                    </div>
                  </div>
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {showQrPreview
            ? (
              <aside className="min-h-56 p-0">
                <div className="mb-3">
                  <div className="text-sm font-medium text-white">
                    Generated QR Code
                  </div>
                  <div className="text-xs text-white/45">
                    {normalizedUrl}
                  </div>
                </div>

                <div className="flex min-h-40 items-center justify-center p-0">
                  {qrCodeLoading
                    ? (
                      <div className="text-sm text-white/55">
                        Generating QR code...
                      </div>
                    )
                    : qrCodeError
                    ? (
                      <div className="max-w-xs text-center text-sm text-red-300">
                        {qrCodeError}
                      </div>
                    )
                    : qrCodeDataUrl
                    ? (
                      <img
                        src={qrCodeDataUrl}
                        alt={`QR code for ${normalizedUrl}`}
                        className="h-48 w-48 rounded-xl bg-white p-3"
                      />
                    )
                    : (
                      <div className="max-w-xs text-center text-sm text-white/45">
                        The QR code will appear here after you enter a valid
                        link.
                      </div>
                    )}
                </div>
              </aside>
            )
            : null}
        </div>

        <section>
          <Separator className="bg-(--text-primary)/20 my-2" />

          <div className="text-xs text-gray-400  mx-3 mb-3">
            Use ↑ ↓ to navigate · Press escape to close searchbar · Click or
            press Enter to open
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function isValidUrl(url?: string) {
  if (!url) return false;

  try {
    let withScheme = url;

    // if no scheme, assume https://
    if (!url.match(/^\w+:\/\//)) {
      withScheme = `https://${url}`;
    }

    const parsed = new URL(withScheme);

    // hostname must exist and contain at least one dot (e.g., example.com)
    if (!parsed.hostname || !parsed.hostname.includes(".")) return false;

    return true;
  } catch {
    return false;
  }
}
