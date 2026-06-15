"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getLinksCollectionsAction, getLinksFoldersAction, getLinksItemsAction, getLinksTagsAction } from '@/lib/apiClient';
import LinksDetailView, { type LinkFolderRecord, type LinkItemRecord, type LinkTagRecord } from "@/components/links/LinksDetailView";
import CreateLinksItemDialog from "@/components/links/CreateLinksItemDialog";
import useAuth from "@/context/useAuth";

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
    const { token, withAuth } = useAuth();
    const [collections, setCollections] = useState<LinkCollection[]>([]);
    const [folders, setFolders] = useState<LinkFolderRecord[]>([]);
    const [items, setItems] = useState<LinkItemRecord[]>([]);
    const [tags, setTags] = useState<LinkTagRecord[]>([]);
    const [createLinkOpen, setCreateLinkOpen] = useState(false);

    useEffect(() => {
        if (!token || !tagId) return;

        let mounted = true;

        const load = async () => {
            try {
                const [collectionsData, tagsData] = await Promise.all([
                    withAuth((auth) => getLinksCollectionsAction(auth)),
                    withAuth((auth) => getLinksTagsAction(auth)),
                ]);

                if (!mounted) return;

                const collectionRecords = Array.isArray(collectionsData) ? (collectionsData as LinkCollection[]) : [];
                const collectionPayloads = await Promise.all(collectionRecords.map(async (collection) => {
                    const [foldersData, itemsData] = await Promise.all([
                        withAuth((auth) => getLinksFoldersAction(auth, collection.id)),
                        withAuth((auth) => getLinksItemsAction(auth, collection.id)),
                    ]);

                    return {
                        folders: Array.isArray(foldersData) ? (foldersData as LinkFolderRecord[]) : [],
                        items: Array.isArray(itemsData) ? (itemsData as LinkItemRecord[]) : [],
                    };
                }));

                if (!mounted) return;

                setCollections(Array.isArray(collectionRecords) ? collectionRecords : []);
                setTags(Array.isArray(tagsData) ? (tagsData as LinkTagRecord[]) : []);
                setFolders(collectionPayloads.flatMap((entry) => entry.folders));
                setItems(collectionPayloads.flatMap((entry) => entry.items));
            } catch (error) {
                console.error("Failed to load tag details:", error);
                if (mounted) {
                    setCollections([]);
                    setFolders([]);
                    setItems([]);
                    setTags([]);
                }
            }
        };

        load();

        return () => {
            mounted = false;
        };
    }, [tagId, token, withAuth]);

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

                    setItems((current) => [link as LinkItemRecord, ...current.filter((item) => item.id !== link.id)]);
                }}
            />
        </>
    );
}