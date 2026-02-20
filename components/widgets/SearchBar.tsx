'use client';
import { useEffect, useState } from 'react';
import useAuth from "@/context/useAuth";
import CommandBar from './CommandBar';
import { get } from '@/lib/apiClient';

type SearchBarProps = {
  useRedirect: boolean;
  defaultOpen?: boolean;
};

type SearchItem = {
  name: string;
  icon: string;
  secondaryInfo: string;
  type: 'link';
  action: string;
  tags?: string[];
};


export default function SearchBar({ useRedirect, defaultOpen }: SearchBarProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [open, setOpen] = useState(false); // control CommandBar

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
  const { token } = useAuth();

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const signal = controller.signal;

    async function fetchItems() {
      setLoadingItems(true);
      setItemsError(null);

        try {
        const tokenToUse = token;
        const data = await get('/searchItems', { token: tokenToUse, signal });
        setSearchItems(Array.isArray(data) ? data : []);
      } catch (err: unknown) {
        const e = err as any;
        console.warn('Failed to load searchItems', err);
        if (e?.status === 401 || e?.status === 403) {
          setItemsError('Unauthorized (invalid token)');
        } else {
          setItemsError(e?.message ?? 'Failed to load items');
        }
        setSearchItems([]);
      } finally {
        setLoadingItems(false);
      }
    }

    fetchItems();

    return () => {
      controller.abort();
    };
  }, [open]);

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
        <CommandBar open={open} setOpen={setOpen} searchItems={searchItems} />
      </div>
    </>
  );
}
