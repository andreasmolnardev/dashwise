"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchResult {
    display_name: string;
    lat: string;
    lon: string;
}

interface LocationSelectFormProps {
    value: { displayName: string; coordinates: string };
    onChange: (val: { displayName: string; coordinates: string }) => void;
}

export default function LocationSelectFormComponent({
    value,
    onChange,
}: LocationSelectFormProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [animateResults, setAnimateResults] = useState(false);
    const [loading, setLoading] = useState(false);

    async function runNominatimSearch(q: string) {
        if (!q) {
            setSearchResults([]);
            setHasSearched(false);
            setAnimateResults(false);
            return;
        }

        setHasSearched(true);
        setLoading(true);

        try {
            const res = await fetch(`/api/v1/locations?q=${encodeURIComponent(q)}`);
            if (!res.ok) throw new Error("API error");

            const json = await res.json();
            setSearchResults(json || []);
            setAnimateResults(true);
        } catch (err) {
            console.error(err);
            setSearchResults([]);
            setAnimateResults(false);
        }

        setLoading(false);
    }

    function selectSearchResult(r: SearchResult) {
        onChange({
            displayName: r.display_name,
            coordinates: `${parseFloat(r.lat).toFixed(6)}, ${parseFloat(r.lon).toFixed(6)}`,
        });

        setSearchResults([]);
        setSearchQuery("");
        setHasSearched(false);
        setAnimateResults(false);
    }

    return (
        <div className="space-y-3">
            <Label htmlFor="osm-search">Search location</Label>

            <div className="flex gap-2">
                <Input
                    id="osm-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runNominatimSearch(searchQuery)}
                    placeholder="City, address, place..."
                />
                <Button disabled={loading} onClick={() => runNominatimSearch(searchQuery)}>
                    {loading ? "Loading..." : "Search"}
                </Button>
            </div>

            {hasSearched ? (
                loading ? (
                    <div className="text-center text-sm border rounded p-2">Loading…</div>
                ) : searchResults.length > 0 ? (
                    <div className="max-h-48 overflow-auto rounded border p-2 frosted">
                        {searchResults.map((r, idx) => (
                            <button
                                key={idx}
                                onClick={() => selectSearchResult(r)}
                                className={`w-full text-left py-1 transition-all duration-300 transform hover:text-(--primary) ${
                                    animateResults
                                        ? "opacity-100 translate-y-0"
                                        : "opacity-0 -translate-y-2"
                                }`}
                                style={{ transitionDelay: `${idx * 50}ms` }}
                            >
                                {r.display_name}
                                <div className="text-xs opacity-60">
                                    {Number(r.lat).toFixed(5)}, {Number(r.lon).toFixed(5)}
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-sm border rounded p-2">Nothing found</div>
                )
            ) : null}

            <div className="text-sm text-(--text-primary)">
                Selected: <strong>{value.displayName || "none"}</strong>
                {value.coordinates ? <span> ({value.coordinates})</span> : null}
            </div>
        </div>
    );
}
