"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppTemplate, { GroupLabel, Sidebar, Tab, Content } from "@/components/apps/LayoutTemplate";
import { getLinksCollectionsAction, getLinksTagsAction } from '@/lib/apiClient';
import CreateLinksCollectionDialog from "@/components/links/CreateLinksCollectionDialog";
import CreateLinksTagDialog from "@/components/links/CreateLinksTagDialog";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
};

type LinkTag = {
    id: string;
    name: string;
    color?: string;
};

export default function LinksLayout({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const collectionsQuery = useApiQuery(queryKeys.links.collections, getLinksCollectionsAction);
    const tagsQuery = useApiQuery(queryKeys.links.tags, getLinksTagsAction);
    const collections = Array.isArray(collectionsQuery.data) ? collectionsQuery.data as LinkCollection[] : [];
    const tags = Array.isArray(tagsQuery.data) ? tagsQuery.data as LinkTag[] : [];
    const [createListOpen, setCreateListOpen] = useState(false);
    const [renameListOpen, setRenameListOpen] = useState(false);
    const [createTagOpen, setCreateTagOpen] = useState(false);
    const [editingCollection, setEditingCollection] = useState<LinkCollection | null>(null);
    const [renamingCollection, setRenamingCollection] = useState<LinkCollection | null>(null);
    const [editingTag, setEditingTag] = useState<LinkTag | null>(null);

    const userCollections = useMemo(
        () => collections.filter((collection) => {
            const type = String(collection.type ?? "").toLowerCase();
            const name = String(collection.name ?? "").trim().toLowerCase();
            return type !== "home" && name !== "home";
        }),
        [collections],
    );

    return (
        <AppTemplate title="Links">
            <Sidebar>
                <Tab dst="/apps/links/home" icon="fa6-solid:house" title="Home" />
                <GroupLabel
                    group="Lists"
                    title="Lists"
                    actions={[
                        {
                            icon: "fa6-solid:plus",
                            title: "Create new list",
                            action: () => {
                                setEditingCollection(null);
                                setCreateListOpen(true);
                            },
                        },
                    ]}
                />
                {userCollections.map((collection) => (
                    <Tab
                        key={collection.id}
                        dst={`/apps/links/lists/${collection.id}`}
                        icon={collection.icon || "fa6-solid:folder-open"}
                        title={collection.name}
                        group="Lists"
                        dropdownActions={[
                            {
                                label: "Edit",
                                icon: "fa6-solid:pen-to-square",
                                action: () => {
                                    setEditingCollection(collection);
                                    setCreateListOpen(true);
                                },
                            },
                            {
                                label: "Rename",
                                icon: "fa6-solid:font",
                                action: () => {
                                    setRenamingCollection(collection);
                                    setRenameListOpen(true);
                                },
                            },
                        ]}
                    />
                ))}
                <GroupLabel
                    group="Tags"
                    title="Tags"
                    actions={[
                        {
                            icon: "fa6-solid:plus",
                            title: "Create new tag",
                            action: () => {
                                setEditingTag(null);
                                setCreateTagOpen(true);
                            },
                        },
                    ]}
                />
                {tags.map((tag) => (
                    <Tab
                        key={tag.id}
                        dst={`/apps/links/tags/${tag.id}`}
                        icon="fa6-solid:hashtag"
                        title={tag.name}
                        group="Tags"
                        dropdownActions={[
                            {
                                label: "Edit tag",
                                icon: "fa6-solid:pen-to-square",
                                action: () => {
                                    setEditingTag(tag);
                                    setCreateTagOpen(true);
                                },
                            },
                        ]}
                    />
                ))}
            </Sidebar>

            <Content>{children}</Content>

            <CreateLinksCollectionDialog
                open={createListOpen}
                onOpenChange={(open) => {
                    setCreateListOpen(open);
                    if (!open) setEditingCollection(null);
                }}
                collection={editingCollection}
                onSaved={(collection) => {
                    queryClient.setQueryData(["api", token, ...queryKeys.links.collections], (current: LinkCollection[] | undefined) =>
                        [collection, ...(current ?? []).filter((item) => item.id !== collection.id)],
                    );
                    navigate(`/apps/links/lists/${collection.id}`);
                }}
            />

            <CreateLinksCollectionDialog
                open={renameListOpen}
                onOpenChange={(open) => {
                    setRenameListOpen(open);
                    if (!open) setRenamingCollection(null);
                }}
                collection={renamingCollection}
                renameOnly
                onSaved={(collection) => {
                    queryClient.setQueryData(["api", token, ...queryKeys.links.collections], (current: LinkCollection[] | undefined) =>
                        [collection, ...(current ?? []).filter((item) => item.id !== collection.id)],
                    );
                    navigate(`/apps/links/lists/${collection.id}`);
                }}
            />

            <CreateLinksTagDialog
                open={createTagOpen}
                onOpenChange={(open) => {
                    setCreateTagOpen(open);
                    if (!open) setEditingTag(null);
                }}
                tag={editingTag}
                onSaved={(tag) => {
                    queryClient.setQueryData(["api", token, ...queryKeys.links.tags], (current: LinkTag[] | undefined) =>
                        [tag, ...(current ?? []).filter((item) => item.id !== tag.id)],
                    );
                    navigate(`/apps/links/tags/${tag.id}`);
                }}
            />
        </AppTemplate>
    );
}
