'use client';
import { useEffect, useRef, useState } from 'react';
import useAuth from "@/context/useAuth";
import CommandBar from './CommandBar';
import { getSearchItemsAction } from '@/lib/apiClient';
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

type SearchBarProps = {
  useRedirect: boolean;
  defaultOpen?: boolean;
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


export default function SearchBar({ useRedirect, defaultOpen }: SearchBarProps) {
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


  const handleFocus = () => {
    if (useRedirect) {
      setRedirecting(true);
      setTimeout(() => { }, 30);
    }
    setOpen(true);
  };

  return (
    <>
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

        {/* Pass fetched items into CommandBar */}
        <CommandBar open={open} setOpen={setOpen} searchItems={searchItems} config={user?.searchPreferences ?? {}}/>
      </div>
    </>
  );
}
