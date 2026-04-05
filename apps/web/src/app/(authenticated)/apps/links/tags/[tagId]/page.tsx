"use client";

import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getLinksTagsAction } from "@/app/actions/links";

type LinkTag = {
    id: string;
    name: string;
    color?: string;
    created?: string;
    updated?: string;
};

export default function LinksTagDetailPage() {
    const { tagId = "" } = useParams();
    const { token, withAuth } = useAuth();
    const [tags, setTags] = useState<LinkTag[]>([]);

    useEffect(() => {
        if (!token || !tagId) return;

        let mounted = true;

        const load = async () => {
            try {
                const data = await withAuth((auth) => getLinksTagsAction(auth));
                if (!mounted) return;
                setTags(Array.isArray(data) ? (data as LinkTag[]) : []);
            } catch (error) {
                console.error("Failed to load tag details:", error);
                if (mounted) setTags([]);
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
        <div className="space-y-6">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-tight">{tag.name}</h1>
                    <span
                        className="h-4 w-4 rounded-full border border-white/20"
                        style={{ backgroundColor: tag.color || "rgba(255,255,255,0.18)" }}
                    />
                </div>
                <p className="max-w-3xl text-sm text-white/60">
                    The current database only exposes tag metadata, so this page shows the tag record itself.
                </p>
            </header>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="frosted rounded-2xl border border-white/10 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">Tag ID</p>
                    <p className="mt-2 break-all text-sm text-white">{tag.id}</p>
                </div>

                <div className="frosted rounded-2xl border border-white/10 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">Color</p>
                    <p className="mt-2 text-sm text-white">{tag.color || "No color set"}</p>
                </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/55">
                <span>Use the Tags tab to switch between records.</span>
                <Link to="/links/tags" className="text-white hover:text-primary">Back to tags</Link>
            </div>
        </div>
    );
}