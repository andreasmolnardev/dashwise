'use client';
import { useEffect, useState } from 'react';
import useAuth from "@/context/useAuth";
import CommandBar from './CommandBar';
import { getSearchItemsAction } from '@/app/actions/searchItems';

type SearchBarProps = {
  useRedirect: boolean;
  defaultOpen?: boolean;
};

type SearchItem = {
  id?: string;
  parentId?: string;
  name: string;
  icon: string;
  secondaryInfo: string;
  type: 'link' | 'app' | 'karakeepBookmark' | 'jellyfinItem' | 'beszelItem' | 'dashdotItem';
  action: string;
  tags?: string[];
};

type SearchItemsCache = {
  fetchedAt: number;
  items: SearchItem[];
};

const SEARCH_ITEMS_CACHE_PREFIX = "dashwise_search_items_cache";
const SEARCH_ITEMS_CACHE_TTL_MS = 10 * 60 * 1000;

function getSearchItemsCacheKey(userId: string | null | undefined) {
  return `${SEARCH_ITEMS_CACHE_PREFIX}:${userId ?? "anonymous"}`;
}

function normalizeSearchItems(raw: unknown): SearchItem[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is SearchItem => !!item && typeof item === "object");
  }

  if (typeof raw !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is SearchItem => !!item && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}

function readSearchItemsCache(cacheKey: string): SearchItemsCache | null {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SearchItemsCache>;
    if (!Array.isArray(parsed.items) || typeof parsed.fetchedAt !== "number") {
      return null;
    }

    return {
      fetchedAt: parsed.fetchedAt,
      items: normalizeSearchItems(parsed.items),
    };
  } catch {
    return null;
  }
}

function writeSearchItemsCache(cacheKey: string, items: SearchItem[]) {
  try {
    const payload: SearchItemsCache = {
      fetchedAt: Date.now(),
      items,
    };

    localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function isCacheFresh(cache: SearchItemsCache | null) {
  return !!cache && Date.now() - cache.fetchedAt < SEARCH_ITEMS_CACHE_TTL_MS;
}


export default function SearchBar({ useRedirect, defaultOpen }: SearchBarProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [open, setOpen] = useState(false); // control CommandBar
  const { user, withAuth } = useAuth();

  // fetched items from /api/v1/searchItems
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);


  const handleFocus = () => {
    if (useRedirect) {
      setRedirecting(true);
      setTimeout(() => { }, 30);
    }
    setOpen(true);
  };

  // Fetch items when the command bar is opened.
  // Uses Authorization: Bearer <pb_token> from localStorage
  const cacheKey = getSearchItemsCacheKey(user?.id);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const cached = readSearchItemsCache(cacheKey);
    setSearchItems(cached?.items ?? []);

    if (isCacheFresh(cached)) {
      setLoadingItems(false);
      setItemsError(null);
      return;
    }

    async function fetchItems() {
      setLoadingItems(true);
      setItemsError(null);

      try {
        const data = await withAuth((auth) => getSearchItemsAction(auth));
        const normalized = normalizeSearchItems(data);

        if (cancelled) return;

        setSearchItems(normalized);
        writeSearchItemsCache(cacheKey, normalized);
      } catch (err: unknown) {
        if (cancelled) return;

        const e = err as any;
        console.warn('Failed to load searchItems', err);
        if (e?.status === 401 || e?.status === 403) {
          setItemsError('Unauthorized (invalid token)');
        } else {
          setItemsError(e?.message ?? 'Failed to load items');
        }

        if (!cached?.items.length) {
          setSearchItems([]);
        }
      } finally {
        if (cancelled) return;

        setLoadingItems(false);
      }
    }

    fetchItems();

    return () => {
      cancelled = true;
    };
  }, [open, cacheKey, withAuth]);

  return (
    <>
      <div
        className={`flex items-center justify-center border frosted rounded-md
        focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500
        transition-transform duration-300 ${redirecting ? 'scale-105 opacity-70' : 'scale-100 opacity-100'}`}
      >
        <input
          type="text"
          data-slot="input"
          className="w-full bg-transparent px-2 py-1.5 text-sm text-gray-900 dark:text-white placeholder-(--text-on-frosted) hover:placeholder-(--text-color) 
               focus:outline-none"
          placeholder="Search..."
          onFocus={handleFocus}
        />

        {/* Pass fetched items into CommandBar */}
        <CommandBar open={open} setOpen={setOpen} searchItems={searchItems} config={user?.searchPreferences ?? {}}/>
      </div>
    </>
  );
}
