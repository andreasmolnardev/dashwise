"use client";

import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getLinksCollectionsAction } from "@/app/actions/links";

type LinkCollection = {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
};

export default function LinksListsPage() {
    const { token, withAuth } = useAuth();
    const [collections, setCollections] = useState<LinkCollection[]>([]);

    useEffect(() => {
        if (!token) return;

        let mounted = true;

        const load = async () => {
            try {
                const data = await withAuth((auth) => getLinksCollectionsAction(auth));
                if (!mounted) return;
                setCollections(Array.isArray(data) ? (data as LinkCollection[]) : []);
            } catch (error) {
                console.error("Failed to load link lists:", error);
                if (mounted) setCollections([]);
            }
        };

        load();

        return () => {
            mounted = false;
        };
    }, [token, withAuth]);

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