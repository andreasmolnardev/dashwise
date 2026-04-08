"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppTemplate, { GroupLabel, Sidebar, Tab, Content } from "@/components/apps/LayoutTemplate";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction, getLinksTagsAction } from "@/app/actions/links";
import CreateLinksCollectionDialog from "@/components/links/CreateLinksCollectionDialog";
import CreateHomeTabDialog from "@/components/links/CreateHomeTabDialog";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
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
    const [createTabOpen, setCreateTabOpen] = useState(false);

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
        <AppTemplate title="Bookmarks">
            <Sidebar>
                <Tab dst="/links/home" icon="fa6-solid:house" title="Home" />
                <GroupLabel
                    group="Lists"
                    title="Lists"
                    actions={[
                        {
                            icon: "fa6-solid:folder-plus",
                            title: "Create new list",
                            action: () => setCreateListOpen(true),
                        },
                        {
                            icon: "fa6-solid:layer-group",
                            title: "Create new tab",
                            action: () => setCreateTabOpen(true),
                        },
                    ]}
                />
                <Tab dst="/links/lists" icon="fa6-solid:list" title="Lists" isRoot />
                {userCollections.map((collection) => (
                    <Tab
                        key={collection.id}
                        dst={`/links/lists/${collection.id}`}
                        icon="fa6-solid:folder-open"
                        title={collection.name}
                        group="Lists"
                    />
                ))}
                <GroupLabel group="Tags" title="Tags" />
                <Tab dst="/links/tags" icon="fa6-solid:tag" title="Tags" isRoot />
                {tags.map((tag) => (
                    <Tab
                        key={tag.id}
                        dst={`/links/tags/${tag.id}`}
                        icon="fa6-solid:hashtag"
                        title={tag.name}
                        group="Tags"
                    />
                ))}
            </Sidebar>

            <Content>{children}</Content>

            <CreateLinksCollectionDialog
                open={createListOpen}
                onOpenChange={setCreateListOpen}
                onCreated={(collection) => {
                    setCollections((current) => [collection, ...current.filter((item) => item.id !== collection.id)]);
                    navigate(`/links/lists/${collection.id}`);
                }}
            />

            <CreateHomeTabDialog
                open={createTabOpen}
                onOpenChange={setCreateTabOpen}
            />
        </AppTemplate>
    );
}