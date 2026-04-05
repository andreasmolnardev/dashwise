"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Label } from "@radix-ui/react-label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface Icon {
    Name: string;
    Reference: string;
    SVG: "Yes" | "No";
    PNG: "Yes" | "No";
    Light: "Yes" | "No";
    Dark: "Yes" | "No";
    Category: string;
    Tags?: string;
    CreatedAt?: string;
}

export interface IconResult {
    variant?: string | null;
    iconSet?: "default" | "mono" | "custom" | null;
    name?: string | null;
    url?: string | null;
}

type PickerSource = "default" | "mono" | "iconify";

const ICONIFY_COLLECTIONS = [
    { value: "mdi", label: "Material Design Icons" },
    { value: "fa6-solid", label: "Font Awesome Solid" },
    { value: "tabler", label: "Tabler" },
    { value: "heroicons", label: "Heroicons" },
    { value: "lucide", label: "Lucide" },
    { value: "material-symbols", label: "Material Symbols" },
    { value: "solar", label: "Solar" },
    { value: "ph", label: "Phosphor" },
] as const;

const ICONIFY_API_PREFIX = "https://api.iconify.design/";
const DEFAULT_ICONIFY_COLOR = "#ffffff";

export function isIconifyUrl(source?: string | null) {
    return Boolean(source && (
        source.startsWith(ICONIFY_API_PREFIX)
        || (source.includes(":") && !source.startsWith("http://") && !source.startsWith("https://"))
    ));
}

export function getIconifySlugFromUrl(source?: string | null) {
    if (!source) return null;

    if (source.startsWith(ICONIFY_API_PREFIX)) {
        try {
            const parsed = new URL(source as string);
            return parsed.pathname.replace(/^\//, "").replace(/\.svg$/, "");
        } catch {
            return null;
        }
    }

    return isIconifyUrl(source) ? source : null;
}

export function getIconifyColorFromUrl(source?: string | null) {
    if (!isIconifyUrl(source)) return null;

    try {
        const parsed = new URL(source as string);
        return parsed.searchParams.get("color");
    } catch {
        return null;
    }
}

export function buildIconifyUrl(iconName: string) {
    return `${ICONIFY_API_PREFIX}${iconName}.svg`;
}

export function getMonoIconReferenceFromUrl(source?: string | null) {
    if (!source) return null;

    const match = source.match(/^\/icons\/webp\/([^/]+?)(?:-(?:light|dark))?\.webp(?:\?.*)?$/i);
    return match?.[1] ?? null;
}

type IconifySelectionDetail = {
    iconName?: string;
    collection?: string;
    name?: string;
    svg?: string;
};

const ICON_BATCH_SIZE = 120;
const EMPTY_ICONS: Icon[] = [];

let iconCatalogPromise: Promise<Icon[]> | null = null;

export function loadIconCatalog() {
    if (!iconCatalogPromise) {
        iconCatalogPromise = fetch("/icons/index.json")
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`Failed to load icons (${res.status})`);
                }

                return res.json() as Promise<Icon[]>;
            })
            .catch((error) => {
                iconCatalogPromise = null;
                throw error;
            });
    }

    return iconCatalogPromise;
}

function IconifyPickerPanel({
    collection,
    selected,
    searchTerm,
    onSelect,
}: {
    collection: string;
    selected: string | null;
    searchTerm: string;
    onSelect: (icon: IconResult) => void;
}) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const pickerRef = useRef<HTMLElement | null>(null);
    const onSelectRef = useRef(onSelect);
    const [isReady, setIsReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        onSelectRef.current = onSelect;
    }, [onSelect]);

    useEffect(() => {
        let cancelled = false;
        let cleanup: (() => void) | undefined;

        void import("iconify-picker")
            .then(() => {
                if (cancelled || !hostRef.current || pickerRef.current) return;

                const picker = document.createElement("iconify-picker") as HTMLElement;
                picker.setAttribute("mode", "inline");
                picker.setAttribute("height", "35vh");
                picker.setAttribute("collection", collection);
                picker.setAttribute("hide-search", "");
                picker.setAttribute("hide-collection", "");
                picker.setAttribute("part", "iconify-picker");

                if (selected) {
                    picker.setAttribute("selected", selected);
                }

                if (searchTerm) {
                    picker.setAttribute("search", searchTerm);
                }

                const handleSelection = (event: Event) => {
                    const detail = (event as CustomEvent<IconifySelectionDetail>).detail;
                    const iconName = detail?.iconName;
                    const iconCollection = detail?.collection;
                    const iconNameOnly = detail?.name;

                    if (!iconName || !iconCollection || !iconNameOnly) return;

                    onSelectRef.current({
                        iconSet: "custom",
                        variant: "default",
                        name: iconName,
                        url: iconName,
                    });
                };

                picker.addEventListener("icon-selected", handleSelection);
                hostRef.current.innerHTML = "";
                hostRef.current.appendChild(picker);
                pickerRef.current = picker;
                setLoadError(null);
                setIsReady(true);

                cleanup = () => {
                    picker.removeEventListener("icon-selected", handleSelection);
                };
            })
            .catch((error) => {
                console.error(error);
                if (cancelled) return;
                setLoadError("Failed to load Iconify picker");
                setIsReady(false);
            });

        return () => {
            cancelled = true;
            cleanup?.();
            pickerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!pickerRef.current) return;
        pickerRef.current.setAttribute("collection", collection);
    }, [collection]);

    useEffect(() => {
        if (!pickerRef.current) return;
        if (searchTerm) pickerRef.current.setAttribute("search", searchTerm);
        else pickerRef.current.removeAttribute("search");
    }, [searchTerm]);

    useEffect(() => {
        if (!pickerRef.current) return;
        if (selected) pickerRef.current.setAttribute("selected", selected);
        else pickerRef.current.removeAttribute("selected");
    }, [selected]);

    return (
        <div className="relative min-h-[35vh] w-full overflow-hidden rounded-md frosted">
            {!isReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border border-white/10 bg-black/10 text-sm text-white/70">
                    <span>{loadError ?? "Loading Iconify picker..."}</span>
                    {!loadError && <span className="text-xs opacity-70">Searching {collection} icons{searchTerm ? ` for “${searchTerm}”` : ""}</span>}
                </div>
            )}
            <div ref={hostRef} className="min-h-[35vh] w-full overflow-hidden rounded-md" />
        </div>
    );
}


export default function IconPickerComponent({
    initialIcons = EMPTY_ICONS,
    initialSelection,
    onClose,
    onSelect,
}: {
    initialIcons?: Icon[];
    initialSelection?: IconResult | null;
    onClose?: () => void;
    onSelect?: (icon: IconResult) => void;
}) {
    const [icons, setIcons] = useState<Icon[]>(initialIcons);
    const [selected, setSelected] = useState<string | null>(null);
    const [pickerSource, setPickerSource] = useState<PickerSource>("default");
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search.trim().toLowerCase());
    const [iconifyCollection, setIconifyCollection] = useState("mdi");
    const [iconifySelected, setIconifySelected] = useState<string | null>(null);
    const [iconsLoading, setIconsLoading] = useState(initialIcons.length === 0);
    const [iconsError, setIconsError] = useState<string | null>(null);
    const [visibleCount, setVisibleCount] = useState(ICON_BATCH_SIZE);

    useEffect(() => {
        if (!initialSelection?.url) return;

        const iconifySlug = getIconifySlugFromUrl(initialSelection.url);
        if (iconifySlug) {
            setPickerSource("iconify");
            setIconifySelected(iconifySlug);
            setIconifyCollection(iconifySlug.split(":")[0] || "mdi");
            return;
        }

        const monoReference = getMonoIconReferenceFromUrl(initialSelection.url);
        if (monoReference) {
            setPickerSource(initialSelection.iconSet === "mono" ? "mono" : "default");
            setSelected(monoReference);
        }
    }, [initialSelection]);

    useEffect(() => {
        let cancelled = false;

        setIcons(initialIcons);
        setIconsError(null);

        if (initialIcons.length > 0) {
            setIconsLoading(false);
            setVisibleCount(ICON_BATCH_SIZE);
            return () => {
                cancelled = true;
            };
        }

        setIconsLoading(true);
        setVisibleCount(ICON_BATCH_SIZE);

        void loadIconCatalog()
            .then((data) => {
                if (cancelled) return;
                setIcons(data);
            })
            .catch((error) => {
                console.error(error);
                if (cancelled) return;
                setIconsError("Failed to load project icons");
            })
            .finally(() => {
                if (cancelled) return;
                setIconsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [initialIcons]);

    useEffect(() => {
        setVisibleCount(ICON_BATCH_SIZE);
    }, [deferredSearch, pickerSource]);

    const getIconData = (icon: Icon): IconResult => {
        const iconSet = pickerSource === "mono" ? "mono" : "default";
        let variant = "";
        if (pickerSource === "mono") {
            if (icon.Light === "Yes") variant = "light";
            else if (icon.Dark === "Yes") variant = "dark";
        }

        const url = `/icons/webp/${icon.Reference}${variant ? `-${variant}` : ""}.webp`;

        return {
            variant: variant || "default",
            iconSet,
            name: icon.Name,
            url,
        };
    };

    const filteredIcons = useMemo(() => {
        if (!deferredSearch) return icons;

        return icons.filter((icon) => {
            const name = icon.Name.toLowerCase();
            const category = icon.Category.toLowerCase();
            const tags = icon.Tags?.toLowerCase() ?? "";

            return name.includes(deferredSearch) || category.includes(deferredSearch) || tags.includes(deferredSearch);
        });
    }, [deferredSearch, icons]);

    const visibleIcons = useMemo(() => filteredIcons.slice(0, visibleCount), [filteredIcons, visibleCount]);
    const hasMoreIcons = visibleCount < filteredIcons.length;

    const handleSelect = (value: string) => {
        setSelected(value);
        const icon = icons.find((i) => i.Reference === value);
        if (onSelect && icon) onSelect(getIconData(icon));
        if (onClose) onClose();
    };

    const handleIconifySelect = (icon: IconResult) => {
        const iconName = icon.name ?? null;
        if (iconName) {
            setIconifySelected(iconName);
            const [collection] = iconName.split(":");
            if (collection) setIconifyCollection(collection);
        }

        if (onSelect) {
            onSelect({
                ...icon,
                url: iconName ?? icon.url,
            });
        }
        if (onClose) onClose();
    };

    const handleIconScroll = (event: UIEvent<HTMLDivElement>) => {
        if (iconsLoading || !hasMoreIcons) return;

        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        if (scrollHeight - scrollTop - clientHeight > 160) return;

        setVisibleCount((current) => Math.min(current + ICON_BATCH_SIZE, filteredIcons.length));
    };

    const loadMoreIcons = () => {
        setVisibleCount((current) => Math.min(current + ICON_BATCH_SIZE, filteredIcons.length));
    };

    const activeIconifyCollection =
        ICONIFY_COLLECTIONS.find((option) => option.value === iconifyCollection)?.label ?? iconifyCollection;


    return (
        <div>
            <Input
                type="text"
                placeholder="Search icons..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="frosted mb-3 w-full rounded-md border p-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="mb-3 flex flex-col gap-2 rounded-md sm:flex-row sm:items-center sm:justify-between">
                <div className="flex w-fit overflow-hidden rounded-md frosted px-1 py-1 ">
                    {[
                        { key: "default" as const, label: "Default" },
                        { key: "mono" as const, label: "Monocolor" },
                        { key: "iconify" as const, label: "Iconify" },
                    ].map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => setPickerSource(option.key)}
                            className={`px-3 py-1 text-sm transition-colors ${pickerSource === option.key ? "bg-primary/20 text-primary" : "opacity-60"} text-white`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {pickerSource === "iconify" && (
                    <Select
                        value={iconifyCollection}
                        onValueChange={setIconifyCollection}
                    >
                        <SelectTrigger
                            aria-label="Choose icon set"
                            className="h-8 w-full max-w-55 border-white/10 bg-white/10 text-sm sm:w-55"
                        >
                            <SelectValue placeholder="Choose icon set">
                                {activeIconifyCollection}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {ICONIFY_COLLECTIONS.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {pickerSource !== "iconify" ? (
                <>
                    {iconsLoading && filteredIcons.length === 0 ? (
                        <div className="max-h-[35vh] overflow-y-auto rounded-md border border-white/10 p-3">
                            <div className="mb-3 h-4 w-40 animate-pulse rounded bg-white/10" />
                            <div className="grid grid-cols-5 gap-4">
                                {Array.from({ length: 25 }).map((_, index) => (
                                    <div
                                        key={index}
                                        style={{ width: 35, height: 35 }}
                                        className="animate-pulse rounded-md border border-white/10 bg-white/10"
                                    />
                                ))}
                            </div>
                        </div>
                    ) : iconsError && filteredIcons.length === 0 ? (
                        <div className="rounded-md border border-white/10 p-3 text-sm text-white/70">
                            {iconsError}
                        </div>
                    ) : filteredIcons.length === 0 ? (
                        <div className="rounded-md border border-white/10 p-3 text-sm text-white/70">
                            No icons match your search.
                        </div>
                    ) : (
                        <div
                            className="max-h-[35vh] overflow-y-auto pr-1"
                            onScroll={handleIconScroll}
                        >
                            <RadioGroup
                                value={selected ?? undefined}
                                onValueChange={handleSelect}
                                className="grid grid-cols-5 gap-4 justify-items-center"
                            >
                                {visibleIcons.map((icon) => (
                                    <Label
                                        key={icon.Reference}
                                        style={{ width: 35, height: 35 }}
                                        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border bg-white/20 p-1 ${selected === icon.Reference
                                            ? "border-primary bg-primary/20"
                                            : "border-(--text-primary)/20"
                                            }`}
                                    >
                                        <RadioGroupItem
                                            value={icon.Reference}
                                            className="hidden"
                                        />

                                        <img
                                            src={getIconData(icon)?.url ?? ""}
                                            alt={icon.Name}
                                            loading="lazy"
                                            className="h-5 w-5"
                                        />
                                    </Label>
                                ))}
                            </RadioGroup>

                            {hasMoreIcons && (
                                <div className="flex justify-center py-3">
                                    <button
                                        type="button"
                                        onClick={loadMoreIcons}
                                        className="rounded-md border border-white/10 px-3 py-1 text-xs text-white/70 transition-colors hover:border-white/20 hover:text-white"
                                    >
                                        Load more icons
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <>
                    <IconifyPickerPanel
                        collection={iconifyCollection}
                        selected={iconifySelected}
                        searchTerm={search}
                        onSelect={handleIconifySelect}
                    />
                </>
            )}
        </div>
    );
}
