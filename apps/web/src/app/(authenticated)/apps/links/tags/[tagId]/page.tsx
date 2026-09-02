"use client";

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getLinksCollectionsAction, getLinksFoldersAction, getLinksItemsAction, getLinksTagsAction } from '@/lib/apiClient';
import LinksDetailView, { type LinkFolderRecord, type LinkItemRecord, type LinkTagRecord } from "@/components/links/LinksDetailView";
import CreateLinksItemDialog from "@/components/links/CreateLinksItemDialog";
import useAuth from "@/context/useAuth";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    type?: string;
};

function normalizeTagIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object" && "id" in entry) {
                return String((entry as { id?: unknown }).id ?? "");
            }
            return "";
        })
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function hasTag(value: unknown, tagId: string) {
    return normalizeTagIds(value).includes(tagId);
}

function includeFolderAncestors(folderId: string | undefined, foldersById: Map<string, LinkFolderRecord>, includedFolderIds: Set<string>) {
    let currentFolderId = folderId;

    while (currentFolderId && !includedFolderIds.has(currentFolderId)) {
        includedFolderIds.add(currentFolderId);
        currentFolderId = foldersById.get(currentFolderId)?.parentFolder;
    }
}

export default function LinksTagDetailPage() {
    const { tagId = "" } = useParams();
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const detailQuery = useApiQuery(queryKeys.links.tagDetail(tagId), async (auth) => {
        const collectionsData = await getLinksCollectionsAction(auth);
        const tagsData = await getLinksTagsAction(auth);
        const collectionRecords = Array.isArray(collectionsData) ? collectionsData as LinkCollection[] : [];
        const collectionPayloads = await Promise.all(collectionRecords.map(async (collection) => {
            const [foldersData, itemsData] = await Promise.all([
                getLinksFoldersAction(auth, collection.id),
                getLinksItemsAction(auth, collection.id),
            ]);
            return {
                folders: Array.isArray(foldersData) ? foldersData as LinkFolderRecord[] : [],
                items: Array.isArray(itemsData) ? itemsData as LinkItemRecord[] : [],
            };
        }));
        return {
            collections: collectionRecords,
            tags: Array.isArray(tagsData) ? tagsData as LinkTagRecord[] : [],
            folders: collectionPayloads.flatMap((entry) => entry.folders),
            items: collectionPayloads.flatMap((entry) => entry.items),
        };
    }, { enabled: Boolean(tagId) });
    const collections = detailQuery.data?.collections ?? [];
    const folders = detailQuery.data?.folders ?? [];
    const items = detailQuery.data?.items ?? [];
    const tags = detailQuery.data?.tags ?? [];
    const [createLinkOpen, setCreateLinkOpen] = useState(false);

    const tag = useMemo(
        () => tags.find((entry) => entry.id === tagId) ?? null,
        [tags, tagId],
    );

    const { scopedFolders, scopedItems } = useMemo(() => {
        if (!tagId) {
            return { scopedFolders: [] as LinkFolderRecord[], scopedItems: [] as LinkItemRecord[] };
        }

        const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
        const includedFolderIds = new Set<string>();

        for (const folder of folders) {
            if (hasTag(folder.tags, tagId)) {
                includeFolderAncestors(folder.id, foldersById, includedFolderIds);
            }
        }

        const matchingItems = items.filter((item) => hasTag(item.tags, tagId));

        for (const item of matchingItems) {
            includeFolderAncestors(item.folder, foldersById, includedFolderIds);
        }

        return {
            scopedFolders: folders.filter((folder) => includedFolderIds.has(folder.id) || hasTag(folder.tags, tagId)),
            scopedItems: matchingItems,
        };
    }, [folders, items, tagId]);

    if (!tagId) {
        return (
            <div className="frosted rounded-2xl border border-white/10 p-6 text-white/70">
                No tag selected.
            </div>
        );
    }

    if (!tag) {
        return (
            <div className="space-y-4">
                <header className="space-y-1">
                    <h1 className="text-3xl font-semibold tracking-tight">Tag</h1>
                    <p className="text-sm text-white/60">Loading or unavailable tag.</p>
                </header>
            </div>
        );
    }

    return (
        <>
            <LinksDetailView
                title={tag.name}
                description="Folders and links tagged with this label."
                folders={scopedFolders}
                items={scopedItems}
                tags={tags}
                onAddLink={() => setCreateLinkOpen(true)}
            />

            <CreateLinksItemDialog
                open={createLinkOpen}
                onOpenChange={setCreateLinkOpen}
                defaultTagIds={[tagId]}
                onCreated={(link) => {
                    const createdTagIds = normalizeTagIds(link.tags);
                    if (!createdTagIds.includes(tagId)) return;

                    queryClient.setQueryData(["api", token, ...queryKeys.links.tagDetail(tagId)], (current: typeof detailQuery.data) => current ? { ...current, items: [link as LinkItemRecord, ...current.items.filter((item) => item.id !== link.id)] } : current);
                }}
                onFolderCreated={(folder) => {
                    queryClient.setQueryData(["api", token, ...queryKeys.links.tagDetail(tagId)], (current: typeof detailQuery.data) => current ? { ...current, folders: [folder as LinkFolderRecord, ...current.folders.filter((item) => item.id !== folder.id)] } : current);
                }}
            />
        </>
    );
}
