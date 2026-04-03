"use client";

import React, { useEffect, useState } from "react";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import IconPickerComponent from "@/components/settings/IconPicker";
import useAuth from "@/src/context/useAuth";

import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsisH, faPaperclip } from "@fortawesome/free-solid-svg-icons";

export default function SearchEngineDetailsForm({
    engine,
    onSaved,
    formId,
    hideActions,
}: {
    engine?: SearchEngine | null;
    onSaved?: () => void | Promise<void>;
    formId?: string;
    hideActions?: boolean;
}) {
    const { withAuth, user, updateUserProperty } = useAuth();

    const [name, setName] = useState(engine?.name ?? "");
    const [slug, setSlug] = useState(engine?.slug ?? "");
    const [icon, setIcon] = useState(engine?.icon ?? "/icons/svg/default-light.svg");
    const [searchUrl, setSearchUrl] = useState(engine?.url_params ?? "");
    const [urlHome, setUrlHome] = useState(engine?.url_home ?? "");
    const [status, setStatus] = useState<SearchEngine["status"]>(engine?.status ?? "enabled");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [iconEdited, setIconEdited] = useState(Boolean(engine?.icon));
    const [icons, setIcons] = useState<any[]>([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        fetch("/icons/index.json")
            .then((res) => res.json())
            .then((d) => setIcons(d))
            .catch(() => setIcons([]));
    }, []);

    // auto-generate slug from name for new engines
    useEffect(() => {
        if (!engine && name.trim() && !slug) {
            const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            setSlug(s || `engine-${Date.now()}`);
        }
    }, [name, engine, slug]);

    // auto-generate icon path (light svg) until user edits
    useEffect(() => {
        if (!iconEdited && name.trim()) {
            const safeName = name.trim().replace(/\s+/g, "-").toLowerCase();
            setIcon(`/icons/svg/${safeName}-light.svg`);
        }
    }, [name, iconEdited]);

    const isEditing = Boolean(engine);

    // use provided formId or fallback to a stable default
    const effectiveFormId = formId ?? "search-engine-form";

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Basic validation
            if (!name.trim()) throw new Error("Name is required");
            if (!slug.trim()) throw new Error("Slug is required");
            if (!searchUrl.includes("%s")) throw new Error("Search URL must include '%s' placeholder");

            // If urlHome is empty, derive origin/base from searchUrl
            let resolvedHome = urlHome?.trim();
            if (!resolvedHome) {
                try {
                    const sample = searchUrl.replace("%s", "");
                    const u = new URL(sample);
                    resolvedHome = `${u.protocol}//${u.host}`;
                } catch {
                    // fallback to empty string if cannot parse
                    resolvedHome = "";
                }
            }

            const payloadEngine: SearchEngine = {
                name: name || "Untitled",
                slug: slug || `engine-${Date.now()}`,
                icon,
                status,
                url_home: resolvedHome,
                url_params: searchUrl,
            };

            const existingEngines = user?.searchPreferences.searchEngines ?? []
            if (isEditing) {
                const updated = existingEngines.map((s: SearchEngine) =>
                    s.slug === engine!.slug ? payloadEngine : s
                );
                await withAuth((auth) => updateUserProperty("searchPreferences", { ...user?.searchPreferences, searchEngines: updated }));
            } else {
                const updated = [...existingEngines, payloadEngine];
                await withAuth((auth) => updateUserProperty("searchPreferences", { ...user?.searchPreferences, searchEngines: updated }));
            }

            if (onSaved) await onSaved();
        } catch (err: any) {
            setError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <form id={effectiveFormId} onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-full">
                <Label htmlFor="se-name">Name</Label>
                <Input
                    id="se-name"
                    placeholder="New Search Engine"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="frosted"
                />
            </div>



            <div className="col-span-full"><Label htmlFor="se-search" className="mt-2">
                Search URL
            </Label>
                <Input
                    id="se-search" placeholder="use %s as placeholder for search string"
                    value={searchUrl}
                    onChange={(e) => setSearchUrl(e.target.value)}
                    className="frosted"
                /></div>

            <div><Label className="mt-2">Status</Label>
                <Select onValueChange={(v) => setStatus(v as SearchEngine["status"])} value={status}>
                    <SelectTrigger className="w-[180px] frosted">
                        <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent className="frosted text-foreground">
                        <SelectGroup>
                            <SelectItem value="enabled">Enabled</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                            <SelectItem value="default">Default</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select></div>

            <div><Label htmlFor="se-slug" className="mt-2">
                Shortcut (used for !bangs)
            </Label>
                <Input
                    id="se-slug"
                    value={slug}
                    onChange={(e) => {
                        let value = e.target.value;
                        if (value.startsWith("!")) value = value.slice(1);
                        setSlug(value);
                    }}
                    className="frosted"
                    placeholder="gg"
                /></div>

            <div className="col-span-full"><Label>Icon</Label>
                <div className="flex items-start gap-2">
                    <Label
                        className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent cursor-pointer"
                        title="current"
                    >
                        <div
                            className="bg-white h-[22px] w-[22px]"
                            style={{
                                maskImage: icon ? `url(${icon})` : "none",
                                WebkitMaskImage: icon ? `url(${icon})` : "none",
                                maskRepeat: "no-repeat",
                                WebkitMaskRepeat: "no-repeat",
                                maskPosition: "center",
                                WebkitMaskPosition: "center",
                                maskSize: "contain",
                                WebkitMaskSize: "contain",
                            }}
                        />
                    </Label>

                    <Popover modal={true}>
                        <PopoverTrigger>
                            <Label
                                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent cursor-pointer"
                                title="Set icon by link"
                            >
                                <FontAwesomeIcon icon={faPaperclip} />
                            </Label>
                        </PopoverTrigger>

                        <PopoverContent className="frosted p-3 text-foreground w-[300px]">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="iconUrl">Icon URL</Label>
                                <Input
                                    id="iconUrl"
                                    name="iconUrl"
                                    placeholder="https://example.com/icon.svg"
                                    className="frosted"
                                    defaultValue={icon}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        setIcon(value);
                                        setIconEdited(true);

                                        // update hidden input directly
                                        const hidden = document.querySelector<HTMLInputElement>('input[name="icon"]');
                                        if (hidden) hidden.value = value;
                                    }}
                                />
                            </div>
                        </PopoverContent>
                    </Popover>


                    {/* Popover around icon picker */}
                    <Popover modal={true} open={open} onOpenChange={setOpen}>
                        <PopoverTrigger>
                            <Label
                                className="h-[35px] w-[35px] frosted rounded-md flex items-center justify-center outline-2 outline-transparent cursor-pointer"
                                title="Pick icon"
                            >
                                <FontAwesomeIcon icon={faEllipsisH} />
                            </Label>
                        </PopoverTrigger>

                        <PopoverContent className="frosted text-foreground max-w-[480px]">
                            <IconPickerComponent
                                initialIcons={icons}
                                onSelect={(iconObj: any) => {
                                    const ext = iconObj.SVG === "Yes" ? "svg" : "png";
                                    let variant = "";
                                    if (iconObj.Light === "Yes") variant = "-light";
                                    else if (iconObj.Dark === "Yes") variant = "-dark";
                                    const url = `/icons/${ext}/${iconObj.Reference}${variant}.${ext}`;
                                    setIcon(url);
                                    setIconEdited(true);
                                    setOpen(false);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                    <input type="hidden" name="icon" value={icon ?? ""} />
                </div>
            </div>

            {/* Advanced collapsible for Home URL */}
            <details className="mt-2" aria-details="true">
                <summary className="cursor-pointer select-none text-sm text-gray-300">
                    Advanced (Home URL)
                </summary>
                <div className="mt-2">
                    <Label htmlFor="se-home" className="text-xs">
                        Home URL (optional)
                    </Label>
                    <Input
                        id="se-home"
                        value={urlHome}
                        placeholder="https://example.com (leave empty to derive from Search URL)"
                        onChange={(e) => setUrlHome(e.target.value)}
                        className="frosted"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                        If left empty, the base/origin will be derived from the Search URL on save.
                    </p>
                </div>
            </details>

            {error && <div className="text-red-400">{error}</div>}

            {/* only render internal submit button when hideActions is falsy */}
            {!hideActions && (
                <div className="mt-4">
                    <Button type="submit" disabled={loading}>
                        {loading ? (isEditing ? "Saving..." : "Adding...") : isEditing ? "Save" : "Add"}
                    </Button>
                </div>
            )}

        </form >
    );
}
