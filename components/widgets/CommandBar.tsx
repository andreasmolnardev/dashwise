import React from 'react';
import type { SyntheticEvent } from 'react';

import { Dialog, DialogContent } from '../ui/dialog';
import { useConfig } from '@/context/ConfigContext';
import { Separator } from '../ui/separator';
import { DialogTitle } from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGlobe } from '@fortawesome/free-solid-svg-icons';

// --- Types ---

type LinkItem = {
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
  name?: string;
  icon?: string;
  secondaryInfo?: string;
  type?: string;
  action?: string;
  url?: string;
  linkGroup?: string;
  tags?: string[];
};

type CommandBarProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchItems: IncomingSearchItem[];
};


function normalizeConfigLinks(input: IncomingSearchItem[] = []): LinkItem[] {
  return input
    .filter((it) => !it.type || it.type === 'link' || it.type === 'karakeepBookmark' || it.type === 'jellyfinItem')
    .map((it) => {
      const action = (it.action || '').toString().trim();
      let url = '';

      if (action.startsWith('url:')) {
        url = action.slice(4);
      } else if (action.startsWith('command:')) {
        url = action; // keep command: prefix
      } else {
        url = action || (it.url || '');
      }

      let type;

      if (it.type === 'karakeepBookmark') {
        type = 'Karakeep';
      } else if (it.type === 'jellyfinItem') {
        type = 'Jellyfin';
      } else {
        type = "Link"
      }

      return {
        name: it.name || '',
        icon: it.icon || undefined,
        linkGroup: it.secondaryInfo || it.linkGroup || '',
        tags: it.tags || '',
        type,
        url,
      } as LinkItem;
    });
}


export default function CommandBar({ open, setOpen, searchItems }: CommandBarProps) {
  const { config } = useConfig();
  // search engines still read from config (unchanged)
  const searchEngines: SearchEngine[] = (config.searchEngines || []) as SearchEngine[];

  const links: LinkItem[] = React.useMemo(() => normalizeConfigLinks(searchItems || []), [searchItems]);

  const defaultEngine =
    searchEngines.find((se) => se.status === 'default') ||
    searchEngines.find((se) => se.status !== 'disabled') ||
    searchEngines[0];

  const [query, setQuery] = React.useState('');
  const [filtered, setFiltered] = React.useState<LinkItem[]>(links);
  const [highlightIndex, setHighlightIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Ref for the scrollable list container
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Refs for each action item
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // open/close dialog
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQuery('');
      setFiltered(links);
      setHighlightIndex(0);
    }
  }, [open, links]);

  // item filtering
  React.useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setFiltered(links);
      setHighlightIndex(0);
      return;
    }

    const queryWords = q.split(/\s+/).filter(Boolean);

    const results = links
      .map((item) => {
        const tags = (item.tags || []).map(t => t.toLowerCase());
        const matchCount = queryWords.reduce((count, word) =>
          count + (tags.some(tag => tag.includes(word)) ? 1 : 0), 0);
        return { item, matchCount };
      })
      .filter(({ matchCount }) => matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(({ item }) => item);

    setFiltered(results);
    setHighlightIndex(0);
  }, [query, links]);

  // open on cmd/ctrl + k
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setOpen]);

  // parse bang: returns {slug, rest} or null
  const parseBang = (q: string) => {
    const m = q.trim().match(/^!(\w+)\s*(.*)$/s);
    if (!m) return null;
    return { slug: m[1].toLowerCase(), rest: (m[2] || '').trim() };
  };

  // build actions; if a valid bang is present, add a bang action at the top
  const actions = React.useMemo(() => {
    const items = [...filtered];

    const trimmedQuery = query.trim();

    // --- 1. Go to URL (only if valid URL) ---
    if (isValidUrl(trimmedQuery)) {
      items.unshift({
        name: `Go to ${trimmedQuery}`,
        url: trimmedQuery.startsWith('http') ? trimmedQuery : `https://${trimmedQuery}`,
        icon: '/icons/faGlobe.svg', // globe icon
        linkGroup: 'URL',
        type: 'Go to URL',
      } as LinkItem);
    }

    // --- 2. Bang search ---
    const parsed = parseBang(trimmedQuery);
    if (parsed) {
      const engine = searchEngines.find((se) => (se.slug || '').toLowerCase() === parsed.slug);
      if (engine) {
        items.unshift({
          name: `Search with ${engine.name} (${engine.slug ? '!' + engine.slug : ''})`,
          url: '__bang_search__',
          icon: engine.icon,
          linkGroup: engine.name,
          isBangAction: true,
          bangEngineSlug: engine.slug,
          bangEngineName: engine.name,
        } as LinkItem);
      }
    }

    // --- 3. Default search engine (only once) ---
    if (!parsed || !searchEngines.find((se) => (se.slug || '').toLowerCase() === parsed.slug)) {
      items.push({
        name: `Search ${defaultEngine?.name || 'web'}`,
        url: '__search_action__',
        icon: defaultEngine?.icon,
        linkGroup: defaultEngine?.name || 'web',
        type: 'Search',
      } as LinkItem);
    }

    // --- 4. All other engines except default ---
    (searchEngines || [])
      .filter((se) => (se.status || '').toLowerCase() !== 'disabled' && se.slug !== defaultEngine?.slug)
      .forEach((se) => {
        items.push({
          name: `${se.name}${se.slug ? ` (!${se.slug})` : ''}`,
          url: `__engine_search__:${se.slug}`,
          icon: se.icon,
          linkGroup: se.name,
          type: 'Search',
          isSearchEngine: true,
          engineSlug: se.slug,
        } as LinkItem);
      });

    return items;
  }, [filtered, defaultEngine, query, searchEngines]);

  // Keep itemRefs array length in sync with actions length
  React.useEffect(() => {
    itemRefs.current = new Array(actions.length).fill(null);
  }, [actions.length]);

  // Scroll the highlighted item into view as the last visible item
  React.useEffect(() => {
    const el = itemRefs.current[highlightIndex];
    if (!el || !listRef.current) return;

    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    } catch {
      el.scrollIntoView(false);
    }
  }, [highlightIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const actionsCount = actions.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % actionsCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + actionsCount) % actionsCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      triggerAction(highlightIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  function triggerAction(index: number) {
    const a = actions[index];
    if (!a) return;
    if (a.url === '__bang_search__') {
      openBangSearch(query, a.bangEngineSlug);
    } else if (a.url === '__search_action__') {
      openSearch(query);
    } else if (a.url.startsWith('__engine_search__:')) {
      const slug = a.url.split(':', 2)[1];
      openEngineSearch(slug, query);
    } else if (a.url.startsWith('command:')) {
      openCommandClient(a.url);
    } else {
      openUrl(a.url, config?.global?.linkOpenBehaviour);
    }
  }

  function openUrl(url: string, method: 'newtab' | 'sametab' | null = 'sametab') {
    if (!url) return;
    let target: '_self' | '_blank' = '_self';
    if (method === 'newtab') {
      target = '_blank';
    }
    window.open(url, target);
    setOpen(false);
  }

  function openSearch(q: string) {
    const engine = defaultEngine;
    if (!engine) return;
    const template = engine.url_params || engine.url_home || '';
    const searchUrl = template.replace('%s', encodeURIComponent(q || ''));
    if (!searchUrl) return;
    window.open(searchUrl, '_blank');
    setOpen(false);
  }

  function openBangSearch(q: string, slug?: string) {
    if (!slug) return;
    const parsed = parseBang(q);
    const terms = parsed ? parsed.rest : '';
    const engine = searchEngines.find((se) => (se.slug || '').toLowerCase() === (slug || '').toLowerCase());
    if (!engine) return;
    const template = engine.url_params || engine.url_home || '';
    const searchUrl = template.replace('%s', encodeURIComponent(terms || ''));
    if (!searchUrl) return;
    window.open(searchUrl, '_blank');
    setOpen(false);
  }

  function openEngineSearch(slug?: string, q?: string) {
    if (!slug) return;
    const engine = searchEngines.find((se) => (se.slug || '').toLowerCase() === (slug || '').toLowerCase());
    if (!engine) return;
    const template = engine.url_params || engine.url_home || '';
    const searchUrl = template.replace('%s', encodeURIComponent((q || '').trim()));
    if (!searchUrl) return;
    window.open(searchUrl, '_blank');
    setOpen(false);
  }

  function openCommandClient(url: string) {
    try {
      const schemeUrl = url.startsWith('command://') ? url : url.startsWith('command:') ? url.replace('command:', 'client://') : url;
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
      <DialogTitle className='hidden'>Search Bar</DialogTitle>
      <DialogContent className="min-w-[50vw] mx-auto frosted backdrop-blur-md rounded-lg p-0 shadow-lg text-(--text-primary) grid-rows-[auto_35vh_auto] gap-1">
        <div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search your links, integrations, or press Enter to search the web..."
            className="w-full flex-1 mx-3 mt-3 pt-1 rounded border border-none focus:outline-none"
            aria-label="Command search"
          />
          <Separator className='my-2 bg-(--text-primary)/20' />
        </div>

        <div ref={listRef} className="max-h-full overflow-auto  mx-3">
          {actions.map((item, index) => {
            const isSearchAction = item.url === '__search_action__';
            const isBangAction = item.url === '__bang_search__' || item.isBangAction;
            const isCommand = !isSearchAction && !isBangAction && item.url?.startsWith('command:');
            const isHighlighted = highlightIndex === index;
            return (
              <button
                ref={(el) => { itemRefs.current[index] = el; }}
                key={item.url + item.name + index}
                onClick={(e) => onClickLink(e, item)}
                className={`w-full text-left px-2 py-2 flex items-center gap-3 rounded ${isHighlighted ? 'bg-white/20 text-white' : 'hover:bg-white/10'}`}
              >
                <div className={`w-6 h-6 rounded-md flex items-center justify-center bg-white/20`}>
                  {item.icon ? (
                    <Icon src={item.icon} size={4} />
                  ) : isValidUrl(item.url) ? (
                    <FontAwesomeIcon icon={faGlobe} className='text-xs' />
                  ) : (
                    <div className="w-4 h-4 bg-gray-300 rounded-sm" />
                  )}
                </div>
                <div className="flex-1 flex items-center min-w-0">
                  <div className="flex-1 min-w-0 flex gap-2 items-center overflow-hidden">
                    <div className="text-sm font-medium truncate flex-shrink min-w-0">
                      {item.name}
                    </div>

                    <span className="text-xs text-(--text-secondary) truncate flex-shrink-0 max-w-[30%]">
                      {item.linkGroup || ""}
                    </span>
                  </div>

                  <div className="ml-3 text-xs text-(--text-secondary) whitespace-nowrap">
                    {isCommand ? <span className="italic">use client</span> : <span>{item.type}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div>
          <Separator className='bg-(--text-primary)/20 my-2' />

          <div className="text-xs text-gray-400  mx-3 mb-3">Use ↑ ↓ to navigate · Press escape to close searchbar · Click or press Enter to open</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
type IconProps = {
  src?: string;       // URL of the icon
  size?: number;      // optional size in pixels, default is 24
  className?: string; // optional CSS classes
};

export function Icon({ src, size = 24, className }: IconProps) {
  if (!src) {
    // No icon URL provided → render a placeholder
    return <div className={`w-${size} h-${size} bg-gray-300 ${className}`} />;
  }

  // Check if we should use a CSS mask
  // Example condition: URL ends with "-light.<any extension>"
  const shouldMask = /-light\.\w+$/.test(src);

  if (shouldMask) {
    return (
      <div
        className={`w-${size} h-${size} ${className}`}
        style={{
          backgroundColor: 'var(--primary)',
          maskImage: `url(${src})`,
          WebkitMaskImage: `url(${src})`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    );
  }

  // Default: render a normal <img> tag
  return <img src={src} alt="" className={cn("h-4", className)} />;
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
    if (!parsed.hostname || !parsed.hostname.includes('.')) return false;

    return true;
  } catch {
    return false;
  }
}
