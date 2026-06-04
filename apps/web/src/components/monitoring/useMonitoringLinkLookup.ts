"use client";

import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getHomeLinksAction, getLinksCollectionsAction, getLinksItemsAction } from '@/lib/apiClient';

export type MonitoringLinkLookupEntry = {
  id: string;
  title: string;
  url: string;
  sourceType: "home" | "collection";
  collectionId?: string;
  collectionName?: string;
};

export function useMonitoringLinkLookup() {
  const { token, withAuth } = useAuth();
  const [entries, setEntries] = useState<MonitoringLinkLookupEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let mounted = true;

    const load = async () => {
      setLoading(true);

      try {
        const [homeLinks, collections] = await Promise.all([
          withAuth((auth) => getHomeLinksAction(auth)),
          withAuth((auth) => getLinksCollectionsAction(auth)),
        ]);

        const collectionRecords = Array.isArray(collections) ? collections : [];
        const collectionById = new Map<string, { id: string; name?: string; type?: string }>(
          collectionRecords.map((collection: any) => [
            String(collection.id),
            { id: String(collection.id), name: collection.name, type: collection.type },
          ]),
        );

        const itemsByCollection = await Promise.all(
          collectionRecords.map(async (collection: any) => {
            const items = await withAuth((auth) => getLinksItemsAction(auth, String(collection.id)));
            return { collection, items: Array.isArray(items) ? items : [] };
          }),
        );

        if (!mounted) return;

        const nextEntries: MonitoringLinkLookupEntry[] = [];

        for (const item of Array.isArray(homeLinks) ? homeLinks : []) {
          nextEntries.push({
            id: String(item.id),
            title: String(item.title || item.name || item.url || item.id),
            url: String(item.url || ""),
            sourceType: "home",
            collectionId: undefined,
            collectionName: undefined,
          });
        }

        for (const { collection, items } of itemsByCollection) {
          const collectionMeta = collectionById.get(String(collection.id));
          for (const item of items) {
            nextEntries.push({
              id: String(item.id),
              title: String(item.title || item.url || item.id),
              url: String(item.url || ""),
              sourceType: collectionMeta?.type === "home" ? "home" : "collection",
              collectionId: String(collection.id),
              collectionName: collectionMeta?.name,
            });
          }
        }

        setEntries(nextEntries);
      } catch (err) {
        console.error("Failed to load monitoring link lookup:", err);
        if (mounted) {
          setEntries([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [token, withAuth]);

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  return { entries, entryById, loading };
}
