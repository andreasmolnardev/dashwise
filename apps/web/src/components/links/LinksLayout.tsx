"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppTemplate, { GroupLabel, Sidebar, Tab, Content } from "@/components/apps/LayoutTemplate";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction, getLinksTagsAction } from "@/app/actions/links";
import CreateLinksCollectionDialog from "@/components/links/CreateLinksCollectionDialog";
import CreateLinksTagDialog from "@/components/links/CreateLinksTagDialog";

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
    const { token, withAuth } = useAuth();
    const navigate = useNavigate();
    const [collections, setCollections] = useState<LinkCollection[]>([]);
    const [tags, setTags] = useState<LinkTag[]>([]);
    const [createListOpen, setCreateListOpen] = useState(false);
    const [createTagOpen, setCreateTagOpen] = useState(false);
    const [editingCollection, setEditingCollection] = useState<LinkCollection | null>(null);
    const [editingTag, setEditingTag] = useState<LinkTag | null>(null);

    useEffect(() => {
        if (!token) {
            setCollections([]);
            setTags([]);
            return;
        }

        let mounted = true;

        const load = async () => {
            try {
                const [collectionsData, tagsData] = await Promise.all([
                    withAuth((auth) => getLinksCollectionsAction(auth)),
                    withAuth((auth) => getLinksTagsAction(auth)),
                ]);

                if (!mounted) return;

                setCollections(Array.isArray(collectionsData) ? (collectionsData as LinkCollection[]) : []);
                setTags(Array.isArray(tagsData) ? (tagsData as LinkTag[]) : []);
            } catch (error) {
                console.error("Failed to load links navigation data:", error);
                if (mounted) {
                    setCollections([]);
                    setTags([]);
                }
            }
        };

        load();

        return () => {
            mounted = false;
        };
    }, [token, withAuth]);

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
                <Tab dst="/links/home" icon="fa6-solid:house" title="Home" />
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
                        dst={`/links/lists/${collection.id}`}
                        icon={collection.icon || "fa6-solid:folder-open"}
                        title={collection.name}
                        group="Lists"
                        dropdownActions={[
                            {
                                label: "Edit list",
                                icon: "fa6-solid:pen-to-square",
                                action: () => {
                                    setEditingCollection(collection);
                                    setCreateListOpen(true);
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
                        dst={`/links/tags/${tag.id}`}
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
                    setCollections((current) => [collection, ...current.filter((item) => item.id !== collection.id)]);
                    navigate(`/links/lists/${collection.id}`);
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
                    setTags((current) => [tag, ...current.filter((item) => item.id !== tag.id)]);
                    navigate(`/links/tags/${tag.id}`);
                }}
            />
        </AppTemplate>
    );
}