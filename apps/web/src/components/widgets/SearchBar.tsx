'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify-icon/react';
import useAuth from "@/context/useAuth";
import CommandBar from './CommandBar';
import { getSearchItemsAction } from '@/lib/apiClient';
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

type SearchBarProps = {
  useRedirect: boolean;
  defaultOpen?: boolean;
  showTrigger?: boolean;
  enableGlobalShortcut?: boolean;
  triggerStyle?: 'bar' | 'nav';
};

type ProxyAction = {
  type: string;
  url?: string;
  proxy?: boolean;
};

type SearchItem = {
  id?: string;
  parentId?: string;
  name: string;
  icon: string;
  secondaryInfo: string;
  type: 'link' | 'app' | 'karakeepBookmark' | 'jellyfinItem' | 'beszelItem' | 'dashdotItem';
  action: string | ProxyAction;
  tags?: string[];
};

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


export default function SearchBar({
  useRedirect,
  defaultOpen,
  showTrigger = true,
  enableGlobalShortcut = false,
  triggerStyle = 'bar',
}: SearchBarProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [open, setOpen] = useState(() => !!defaultOpen); // control CommandBar
  const didMountRef = useRef(false);
  const { user } = useAuth();

  // fetched items from /api/v1/searchItems
  const searchItemsQuery = useApiQuery(queryKeys.links.search, getSearchItemsAction, { enabled: open });
  const searchItems = normalizeSearchItems(searchItemsQuery.data);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    if (!enableGlobalShortcut) return;

    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previousOpen) => !previousOpen);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enableGlobalShortcut]);


  const handleFocus = () => {
    if (useRedirect) {
      setRedirecting(true);
      setTimeout(() => { }, 30);
    }
    setOpen(true);
  };

  return (
    <>
      {showTrigger && (
        triggerStyle === 'nav' ? (
          <button
            type="button"
            onClick={handleFocus}
            className="block group"
            aria-label="Search"
          >
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
              <Icon
                icon="fa6-solid:magnifying-glass"
                className="text-sm text-white/40 group-hover:text-primary transition-colors w-4"
              />
              <span className="text-sm text-white/50 group-hover:text-white transition-colors leading-none">
                Search
              </span>
            </div>
          </button>
        ) : (
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
        )
      )}

      <CommandBar open={open} setOpen={setOpen} searchItems={searchItems} config={user?.searchPreferences ?? {}}/>
    </>
  );
}
