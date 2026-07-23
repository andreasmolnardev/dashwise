"use client";

import { useMemo } from "react";
import { getHomeLinksAction, getLinksCollectionsAction, getLinksItemsAction } from '@/lib/apiClient';
import { useApiQuery } from "@/hooks/useApiQuery";

export type LinksLookupEntry = {
  id: string;
  title: string;
  url: string;
  sourceType: "home" | "collection";
  collectionId?: string;
  collectionName?: string;
};

export function useLinksLookup() {
  const lookupQuery = useApiQuery(["monitoring", "link-lookup"], async (auth) => {
        const [homeLinks, collections] = await Promise.all([
          getHomeLinksAction(auth),
          getLinksCollectionsAction(auth),
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
            const items = await getLinksItemsAction(auth, String(collection.id));
            return { collection, items: Array.isArray(items) ? items : [] };
          }),
        );

        const nextEntries: LinksLookupEntry[] = [];

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

        return nextEntries;
  });
  const entries = lookupQuery.data ?? [];
  const loading = lookupQuery.isLoading;

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  return { entries, entryById, loading };
}
