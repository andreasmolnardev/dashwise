// TODO fix search preferences implementation
"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Plus, Loader2, ExternalLink, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input"; // shadcn input
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";

// --- Types ---

interface DDGBang {
    c: string; // Category
    d: string; // Domain
    r: number; // Rank
    s: string; // Name
    sc: string; // Subcategory
    t: string; // Trigger/Slug
    u: string; // URL Template
}

interface SearchEngine {
    icon: string;
    name: string;
    slug: string;
    status: "enabled" | "disabled";
    url_home: string;
    url_params: string;
}

// --- Helper Functions ---

const transformToSearchEngine = (bang: DDGBang): SearchEngine => {
    return {
        icon: `https://icons.duckduckgo.com/ip3/${bang.d}.ico`,
        name: bang.s,
        slug: bang.t,
        status: "enabled",
        url_home: bang.d.startsWith("http") ? bang.d : `https://${bang.d}`,
        url_params: bang.u.replace("{{{s}}}", "%s"),
    };
};

export default function SearchEngineBrowseFeedComponent() {
    const { refreshConfig } = usePageConfig();
    const { user, updateUserProperty } = useAuth();
    const [bangs, setBangs] = useState<DDGBang[]>([]);
    const [visibleBangs, setVisibleBangs] = useState<DDGBang[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // debounce search input (200ms)
    useEffect(() => {
        const id = setTimeout(() => setDebouncedSearch(search), 200);
        return () => clearTimeout(id);
    }, [search]);

    const ITEMS_PER_PAGE = 20;

    const loaderRef = useRef<HTMLDivElement>(null);

    // Fetch Data on Mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch("/bangs.js");
                if (!res.ok) throw new Error("Failed to fetch");
                const data: DDGBang[] = await res.json();
                setBangs(data);
                setLoading(false);
            } catch (error) {
                console.error("Error loading search engines:", error);
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Build set of existing slugs from config
    const existingSlugs = React.useMemo(() => {
        const arr = user?.searchPreferences?.searchEngines ?? [];
        return new Set(arr.map((e: any) => String(e.slug)));
    }, [user?.searchPreferences?.searchEngines]);

    // availableBangs: only those not already added
    const availableBangs = React.useMemo(() => {
        if (!bangs || bangs.length === 0) return [];
        return bangs.filter((b) => !existingSlugs.has(b.t));
    }, [bangs, existingSlugs]);

    // Filtered list derived from search (works only on availableBangs)
    const filteredBangs = React.useMemo(() => {
        // Only filter when user typed at least 3 characters
        if (!debouncedSearch || debouncedSearch.trim().length < 3) return availableBangs;
        const q = debouncedSearch.toLowerCase();
        return availableBangs.filter(
            (b) =>
                (b.s && b.s.toLowerCase().includes(q)) ||
                (b.d && b.d.toLowerCase().includes(q)) ||
                (b.t && b.t.toLowerCase().includes(q)) ||
                (b.c && b.c.toLowerCase().includes(q))
        );
    }, [availableBangs, debouncedSearch]);

    // keep visibleBangs in sync with page/filter
    useEffect(() => {
        if (debouncedSearch && debouncedSearch.trim().length >= 3) {
            // show full filtered set while searching (or slice if you prefer pagination)
            setVisibleBangs(filteredBangs);
            setPage(1);
        } else {
            setVisibleBangs(availableBangs.slice(0, page * ITEMS_PER_PAGE));
        }
    }, [availableBangs, page, debouncedSearch, filteredBangs]);

    // Infinite Scroll Logic
    const handleObserver = useCallback(
        (entries: IntersectionObserverEntry[]) => {
            const target = entries[0];
            if (
                target.isIntersecting &&
                !loading &&
                (!debouncedSearch || debouncedSearch.trim().length < 3) &&
                visibleBangs.length < availableBangs.length
            ) {
                const nextPage = page + 1;
                const nextItems = availableBangs.slice(0, nextPage * ITEMS_PER_PAGE);
                setVisibleBangs(nextItems);
                setPage(nextPage);
            }
        },
        [loading, visibleBangs.length, availableBangs, page, debouncedSearch]
    );

    useEffect(() => {
        const observer = new IntersectionObserver(handleObserver, {
            root: null,
            rootMargin: "20px",
            threshold: 1.0,
        });
        // only observe when not actively searching (i.e. less than 3 chars)
        if ((!debouncedSearch || debouncedSearch.trim().length < 3) && loaderRef.current) {
            observer.observe(loaderRef.current);
        }
        return () => observer.disconnect();
    }, [handleObserver, debouncedSearch]);

    // Add Handler (async, then refresh config)
    const handleAddEngine = async (bang: DDGBang) => {
        const engineConfig = transformToSearchEngine(bang);
        const current = Array.isArray(user?.searchPreferences?.searchEngines) ? user.searchPreferences.searchEngines : [];
        const nextEngines = [...current, engineConfig];
        try {
            await updateUserProperty("searchPreferences", {
                ...(user?.searchPreferences ?? {}),
                searchEngines: nextEngines,
            });
            console.log(`Added ${engineConfig.name}`);
            // Refresh config so the new engine will be filtered out
            try {
                refreshConfig?.();
            } catch (e) {
                // non-fatal: log
                console.warn("refreshConfig failed", e);
            }
        } catch (e) {
            console.error("Failed to add engine", e);
        }
    };

    if (loading && bangs.length === 0) {
        return (
            <div className="mx-auto p-4 space-y-4">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold tracking-tight">Browse Search Engines</h2>
                    <div className="flex items-center gap-2">
                        <div className="w-28">
                            <Skeleton className="h-8 rounded" />
                        </div>
                        <Skeleton className="h-6 w-12 rounded" />
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    {[...Array(6)].map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
                <Badge variant={"secondary"}>{filteredBangs.length} shown</Badge>
                <div className="flex items-center gap-2 flex-1 justify-end">
                    <div className="flex items-center gap-2 border rounded-full px-2 py-1 frosted min-w-0">
                        <Search className="h-4 w-4 opacity-70" />
                        <Input
                            placeholder="Search name, domain, slug, category (3+ chars)..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="outline-none border-none bg-transparent rounded-full flex-1 min-w-0"
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                {visibleBangs.map((bang) => (
                    <BangRow key={bang.t} bang={bang} onAdd={() => handleAddEngine(bang)} />
                ))}
            </div>

            {/* Infinite Scroll Trigger */}
            <div ref={loaderRef} className="flex justify-center p-6">
                {(!debouncedSearch || debouncedSearch.trim().length < 3) && visibleBangs.length < availableBangs.length ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : null}
            </div>
        </div>
    );
}

// --- Row (single-line) sub-component ---
function BangRow({ bang, onAdd }: { bang: DDGBang; onAdd: () => void }) {
    const iconUrl = `https://icons.duckduckgo.com/ip3/${bang.d}.ico`;

    return (
        <article
            className="
            grid grid-cols-[1fr_auto]
            items-center gap-4
            rounded-lg frosted py-3 px-2
            hover:shadow-sm transition
            "
        >
            <div className="flex items-center gap-4 min-w-0">
                <div className="relative h-10 w-10 min-w-10 overflow-hidden rounded-md border border-white/20 p-1 shrink-0">
                    <img
                        src={iconUrl}
                        alt={bang.s}
                        className="h-full w-full object-contain"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = "/icons/svg/google-images.svg";
                        }}
                    />
                </div>

                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium line-clamp-1" title={bang.s}>
                            {bang.s}
                        </h3>
                        <span className="text-xs line-clamp-1">{bang.d}</span>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                        <Badge className="text-xs font-normal">{bang.c}</Badge>
                        <Badge variant="secondary" className="text-xs font-normal font-mono">
                            !{bang.t}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button onClick={onAdd} size="sm" className="whitespace-nowrap">
                    <Plus className="mr-2 h-4 w-4" /> Add
                </Button>

                <Button variant="ghost" size="icon" asChild title="Visit Site">
                    <a href={`https://${bang.d}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                    </a>
                </Button>
            </div>
        </article>
    );
}
