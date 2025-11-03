"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { WidgetInfo } from "@/app/(config-wrapper)/settings/widgets/page";

interface WidgetEditDialogProps {
    open: boolean;
    widget: WidgetInfo | null;
    onClose: () => void;
    onSave: (updatedWidget: WidgetInfo) => void;
}

export default function WidgetEditDialog({ open, widget, onClose, onSave }: WidgetEditDialogProps) {
    const [editedWidget, setEditedWidget] = useState<WidgetInfo | null>(widget);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [animateResults, setAnimateResults] = useState(false);

    useEffect(() => {
        setEditedWidget(widget);
    }, [widget]);

    async function runNominatimSearch(q: string) {
        if (!q) {
            setSearchResults([]);
            setHasSearched(false);
            setAnimateResults(false);
            return;
        }

        setHasSearched(true);

        try {
            const res = await fetch(`/api/v1/locations?q=${encodeURIComponent(q)}`);
            if (!res.ok) {
                console.error("Locations API returned", res.status);
                setSearchResults([]);
                setAnimateResults(false);
                return;
            }
            const json = await res.json();
            setSearchResults(json || []);
            setAnimateResults(true);
        } catch (err) {
            console.error("Locations API error", err);
            setSearchResults([]);
            setAnimateResults(false);
        }
    }

    function selectSearchResult(r: { display_name: string; lat: string; lon: string }) {
        setEditedWidget((prev) =>
            prev
                ? {
                      ...prev,
                      properties: {
                          ...(prev.properties || {}),
                          locationCoordinates: `${parseFloat(r.lat).toFixed(6)}, ${parseFloat(r.lon).toFixed(6)}`,
                          locationDisplayname: r.display_name,
                      },
                  }
                : prev
        );

        setSearchResults([]);
        setSearchQuery("");
        setHasSearched(false);
        setAnimateResults(false);
    }

    if (!editedWidget) return null;

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="frosted text-(--text-primary) max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Widget</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {editedWidget.slug?.includes("weather") ? (
                        <div className="space-y-3">
                            <Label htmlFor="osm-search">Search location</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="osm-search"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setSearchQuery(v);
                                        if (v.trim() === "") {
                                            setHasSearched(false);
                                            setSearchResults([]);
                                            setAnimateResults(false);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") runNominatimSearch(searchQuery);
                                    }}
                                    placeholder="City, address, place..."
                                />
                                <Button onClick={() => runNominatimSearch(searchQuery)}>Search</Button>
                            </div>

                            {hasSearched && searchResults.length > 0 ? (
                                <div className="max-h-48 overflow-auto rounded border p-2 frosted">
                                    {searchResults.map((r, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => selectSearchResult(r)}
                                            className={`w-full text-left py-1 transition-all duration-300 transform ${
                                                animateResults ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
                                            }`}
                                            style={{ transitionDelay: `${idx * 50}ms`, color: "var(--text-primary)" }}
                                        >
                                            {r.display_name}
                                            <div className="text-xs opacity-60">
                                                {Number(r.lat).toFixed(5)}, {Number(r.lon).toFixed(5)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : hasSearched ? (
                                <div className="text-center text-sm text-muted-foreground border rounded p-2">
                                    Nothing found
                                </div>
                            ) : null}

                            <div className="text-sm text-(--text-primary)">
                                Selected:{" "}
                                <strong>{editedWidget.properties?.locationDisplayname ?? "none"}</strong>{" "}
                                {editedWidget.properties?.locationCoordinates ? (
                                    <span>({editedWidget.properties.locationCoordinates})</span>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <>
                            {editedWidget.properties &&
                                Object.entries(editedWidget.properties).map(([key]) => (
                                    <div key={key} className="space-y-2">
                                        <Label htmlFor={key}>{key}</Label>
                                        <Input
                                            id={key}
                                            value={editedWidget.properties?.[key] ?? ""}
                                            onChange={(e) =>
                                                setEditedWidget((prev) =>
                                                    prev
                                                        ? {
                                                              ...prev,
                                                              properties: { ...(prev.properties || {}), [key]: e.target.value },
                                                          }
                                                        : prev
                                                )
                                            }
                                        />
                                    </div>
                                ))}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => editedWidget && onSave(editedWidget)}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
