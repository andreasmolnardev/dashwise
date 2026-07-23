"use client";

import { Link } from "react-router-dom";
import { useMemo } from "react";
import { getLinksCollectionsAction } from '@/lib/apiClient';
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
};

export default function LinksListsPage() {
    const collectionsQuery = useApiQuery(queryKeys.links.collections, getLinksCollectionsAction);
    const collections = (collectionsQuery.data ?? []) as LinkCollection[];

    const lists = useMemo(
        () => collections.filter((collection) => {
            const type = String(collection.type ?? "").toLowerCase();
            const name = String(collection.name ?? "").trim().toLowerCase();
            return type !== "home" && name !== "home";
        }),
        [collections],
    );

    return (
        <div className="space-y-4">
            <header className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight">Lists</h1>
            </header>

            {lists.length === 0 ? (
                <div className="frosted rounded-2xl border border-white/10 p-6 text-sm text-white/60">
                    No additional lists found.
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {lists.map((list) => (
                        <Link
                            key={list.id}
                            to={`/links/lists/${list.id}`}
                            className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20 hover:bg-white/10"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-2">
                                    <h2 className="text-lg font-semibold text-white group-hover:text-primary">{list.name}</h2>
                                    <p className="text-sm text-white/55">
                                        {list.description || "No description yet."}
                                    </p>
                                </div>
                                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-white/45">
                                    {String(list.type ?? "user")}
                                </span>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
