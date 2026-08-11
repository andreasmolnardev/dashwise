"use client";

import { Link } from "react-router-dom";
import { getLinksTagsAction } from '@/lib/apiClient';
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

type LinkTag = {
    id: string;
    name: string;
    color?: string;
};

export default function LinksTagsPage() {
    const tagsQuery = useApiQuery(queryKeys.links.tags, getLinksTagsAction);
    const tags = (tagsQuery.data ?? []) as LinkTag[];

    return (
        <div className="space-y-4">
            <header className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight">Tags</h1>
                <p className="max-w-2xl text-sm text-white/60">
                    Tags are kept as standalone bookmark metadata records in the current schema.
                </p>
            </header>

            {tags.length === 0 ? (
                <div className="frosted rounded-2xl border border-white/10 p-6 text-sm text-white/60">
                    No tags found.
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {tags.map((tag) => (
                        <Link
                            key={tag.id}
                            to={`/apps/links/tags/${tag.id}`}
                            className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20 hover:bg-white/10"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-2">
                                    <h2 className="text-lg font-semibold text-white group-hover:text-primary">{tag.name}</h2>
                                    <p className="text-sm text-white/55">Tap to inspect the tag record.</p>
                                </div>
                                <span
                                    className="mt-1 h-4 w-4 rounded-full border border-white/20"
                                    style={{ backgroundColor: tag.color || "rgba(255,255,255,0.18)" }}
                                />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
