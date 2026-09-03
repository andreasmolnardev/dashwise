"use client";

import { useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction, getLinksFoldersAction, getLinksItemsAction, getLinksTagsAction } from '@/lib/apiClient';
import LinksDetailView, { type LinkFolderRecord, type LinkItemRecord, type LinkTagRecord } from "@/components/links/LinksDetailView";
import CreateLinksItemDialog from "@/components/links/CreateLinksItemDialog";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
};

export default function LinksListDetailPage() {
    const { listId = "" } = useParams();
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const collectionsQuery = useApiQuery(queryKeys.links.collections, getLinksCollectionsAction);
    const foldersQuery = useApiQuery(queryKeys.links.folders(listId), (auth) => getLinksFoldersAction(auth, listId), { enabled: Boolean(listId) });
    const itemsQuery = useApiQuery(queryKeys.links.items(listId), (auth) => getLinksItemsAction(auth, listId), { enabled: Boolean(listId) });
    const tagsQuery = useApiQuery(queryKeys.links.tags, getLinksTagsAction);
    const collections = (collectionsQuery.data ?? []) as LinkCollection[];
    const folders = (foldersQuery.data ?? []) as LinkFolderRecord[];
    const items = (itemsQuery.data ?? []) as LinkItemRecord[];
    const tags = (tagsQuery.data ?? []) as LinkTagRecord[];
    const [createLinkOpen, setCreateLinkOpen] = useState(false);

    const list = useMemo(
        () => collections.find((collection) => collection.id === listId) ?? null,
        [collections, listId],
    );

    if (!listId) {
        return (
            <div className="frosted rounded-2xl border border-white/10 p-6 text-white/70">
                No list selected.
            </div>
        );
    }

    if (!list) {
        return (
            <div className="space-y-4">
                <header className="space-y-1">
                    <h1 className="text-3xl font-semibold tracking-tight">List</h1>
                    <p className="text-sm text-white/60">Loading or unavailable list.</p>
                </header>
            </div>
        );
    }

    return (
        <>
            <LinksDetailView
                title={list.name}
                description={list.description || ""}
                listId={listId}
                folders={folders}
                items={items}
                tags={tags}
                onAddLink={() => setCreateLinkOpen(true)}
                onFolderCreated={(folder) => {
                    queryClient.setQueryData<LinkFolderRecord[]>(["api", token, ...queryKeys.links.folders(listId)], (current = []) => [folder, ...current.filter((existing) => existing.id !== folder.id)]);
                }}
            />

            <CreateLinksItemDialog
                open={createLinkOpen}
                onOpenChange={setCreateLinkOpen}
                defaultCollectionId={listId}
                onCreated={(link) => {
                    if (link.collection !== listId) return;

                    queryClient.setQueryData<LinkItemRecord[]>(["api", token, ...queryKeys.links.items(listId)], (current = []) => [link as LinkItemRecord, ...current.filter((item) => item.id !== link.id)]);
                }}
                onFolderCreated={(folder) => {
                    if (folder.list !== listId) return;

                    queryClient.setQueryData<LinkFolderRecord[]>(["api", token, ...queryKeys.links.folders(listId)], (current = []) => [folder as LinkFolderRecord, ...current.filter((item) => item.id !== folder.id)]);
                }}
            />
        </>
    );
}
