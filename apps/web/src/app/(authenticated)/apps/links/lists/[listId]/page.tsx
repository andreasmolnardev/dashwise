"use client";

import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction, getLinksFoldersAction, getLinksItemsAction } from "@/app/actions/links";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    type?: string;
};

type LinkFolder = {
    id: string;
    list: string;
    name: string;
    icon?: string;
    parentFolder?: string;
};

type LinkItem = {
    id: string;
    url: string;
    title: string;
    iconUrl?: string;
    description?: string;
    collection: string;
    folder?: string;
};

function formatPath(folderId: string, foldersById: Map<string, LinkFolder>) {
    const path: string[] = [];
    let current = foldersById.get(folderId);

    while (current) {
        path.unshift(current.name);
        current = current.parentFolder ? foldersById.get(current.parentFolder) : undefined;
    }

    return path;
}

export default function LinksListDetailPage() {
    const { listId = "" } = useParams();
    const { token, withAuth } = useAuth();
    const [collections, setCollections] = useState<LinkCollection[]>([]);
    const [folders, setFolders] = useState<LinkFolder[]>([]);
    const [items, setItems] = useState<LinkItem[]>([]);

    useEffect(() => {
        if (!token || !listId) return;

        let mounted = true;

        const load = async () => {
            try {
                const [collectionsData, foldersData, itemsData] = await Promise.all([
                    withAuth((auth) => getLinksCollectionsAction(auth)),
                    withAuth((auth) => getLinksFoldersAction(auth, listId)),
                    withAuth((auth) => getLinksItemsAction(auth, listId)),
                ]);

                if (!mounted) return;

                setCollections(Array.isArray(collectionsData) ? (collectionsData as LinkCollection[]) : []);
                setFolders(Array.isArray(foldersData) ? (foldersData as LinkFolder[]) : []);
                setItems(Array.isArray(itemsData) ? (itemsData as LinkItem[]) : []);
            } catch (error) {
                console.error("Failed to load list details:", error);
                if (mounted) {
                    setCollections([]);
                    setFolders([]);
                    setItems([]);
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

    const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

    const rootItems = useMemo(
        () => items.filter((item) => !item.folder),
        [items],
    );

    const folderSections = useMemo(
        () => folders
            .map((folder) => ({
                folder,
                path: formatPath(folder.id, foldersById),
                items: items.filter((item) => item.folder === folder.id),
            }))
            .filter((section) => section.items.length > 0)
            .sort((left, right) => left.path.join(" / ").localeCompare(right.path.join(" / "))),
        [folders, foldersById, items],
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
        <div className="space-y-6">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-tight">{list.name}</h1>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-white/45">
                        {String(list.type ?? "user")}
                    </span>
                </div>
                <p className="max-w-3xl text-sm text-white/60">
                    {list.description || "This list has no description yet."}
                </p>
            </header>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-medium text-white/90">Root links</h2>
                    <span className="text-xs text-white/45">{rootItems.length} items</span>
                </div>

                {rootItems.length === 0 ? (
                    <div className="frosted rounded-2xl border border-white/10 p-5 text-sm text-white/55">
                        No root links in this list.
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {rootItems.map((item) => (
                            <a
                                key={item.id}
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20 hover:bg-white/10"
                            >
                                <div className="space-y-2">
                                    <h3 className="text-base font-medium text-white group-hover:text-primary">{item.title}</h3>
                                    <p className="break-all text-xs text-white/45">{item.url}</p>
                                    <p className="text-sm text-white/55">
                                        {item.description || "No description."}
                                    </p>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-medium text-white/90">Folders</h2>
                    <span className="text-xs text-white/45">{folderSections.length} folders with items</span>
                </div>

                {folderSections.length === 0 ? (
                    <div className="frosted rounded-2xl border border-white/10 p-5 text-sm text-white/55">
                        No folders in this list.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {folderSections.map(({ folder, path, items: folderItems }) => (
                            <div key={folder.id} className="frosted rounded-2xl border border-white/10 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="space-y-1">
                                        <h3 className="text-base font-semibold text-white">{folder.name}</h3>
                                        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                                            {path.join(" / ")}
                                        </p>
                                    </div>
                                    <span className="text-xs text-white/45">{folderItems.length} links</span>
                                </div>

                                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                    {folderItems.map((item) => (
                                        <a
                                            key={item.id}
                                            href={item.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded-2xl border border-white/10 bg-black/10 p-4 transition-colors hover:border-white/20 hover:bg-white/10"
                                        >
                                            <h4 className="font-medium text-white">{item.title}</h4>
                                            <p className="mt-2 break-all text-xs text-white/45">{item.url}</p>
                                            <p className="mt-2 text-sm text-white/55">
                                                {item.description || "No description."}
                                            </p>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/55">
                <span>{items.length} total links</span>
                <Link to="/links/lists" className="text-white hover:text-primary">Back to lists</Link>
            </div>
        </div>
    );
}