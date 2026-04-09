"use client";

import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction, getLinksFoldersAction, getLinksItemsAction, getLinksTagsAction } from "@/app/actions/links";
import LinksDetailView, { type LinkFolderRecord, type LinkItemRecord, type LinkTagRecord } from "@/components/links/LinksDetailView";
import CreateLinksItemDialog from "@/components/links/CreateLinksItemDialog";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
};

export default function LinksListDetailPage() {
    const { listId = "" } = useParams();
    const { token, withAuth } = useAuth();
    const [collections, setCollections] = useState<LinkCollection[]>([]);
    const [folders, setFolders] = useState<LinkFolderRecord[]>([]);
    const [items, setItems] = useState<LinkItemRecord[]>([]);
    const [tags, setTags] = useState<LinkTagRecord[]>([]);
    const [createLinkOpen, setCreateLinkOpen] = useState(false);

    useEffect(() => {
        if (!token || !listId) return;

        let mounted = true;

        const load = async () => {
            try {
                const [collectionsData, foldersData, itemsData, tagsData] = await Promise.all([
                    withAuth((auth) => getLinksCollectionsAction(auth)),
                    withAuth((auth) => getLinksFoldersAction(auth, listId)),
                    withAuth((auth) => getLinksItemsAction(auth, listId)),
                    withAuth((auth) => getLinksTagsAction(auth)),
                ]);

                if (!mounted) return;

                setCollections(Array.isArray(collectionsData) ? (collectionsData as LinkCollection[]) : []);
                setFolders(Array.isArray(foldersData) ? (foldersData as LinkFolderRecord[]) : []);
                setItems(Array.isArray(itemsData) ? (itemsData as LinkItemRecord[]) : []);
                setTags(Array.isArray(tagsData) ? (tagsData as LinkTagRecord[]) : []);
            } catch (error) {
                console.error("Failed to load list details:", error);
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
    }, [listId, token, withAuth]);

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
                folders={folders}
                items={items}
                tags={tags}
                onAddLink={() => setCreateLinkOpen(true)}
            />

            <CreateLinksItemDialog
                open={createLinkOpen}
                onOpenChange={setCreateLinkOpen}
                defaultCollectionId={listId}
                onCreated={(link) => {
                    if (link.collection !== listId) return;

                    setItems((current) => [link as LinkItemRecord, ...current.filter((item) => item.id !== link.id)]);
                }}
            />
        </>
    );
}