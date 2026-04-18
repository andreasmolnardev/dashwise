"use client";

import { Icon } from "@iconify-icon/react";
import AppIcon from "@dashwise/app-icon";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CreateLinksFolderDialog from "@/components/links/CreateLinksFolderDialog";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

export type LinkTagRecord = {
    id: string;
    name: string;
    color?: string;
};

export type LinkFolderRecord = {
    id: string;
    name: string;
    icon?: string;
    parentFolder?: string;
    tags?: string[];
    created?: string;
    updated?: string;
    list?: string;
};

export type LinkItemRecord = {
    id: string;
    url: string;
    title: string;
    iconUrl?: string;
    description?: string;
    collection?: string;
    folder?: string;
    tags?: string[];
    created?: string;
    updated?: string;
};

type FolderNode = {
    folder: LinkFolderRecord;
    children: FolderNode[];
    items: LinkItemRecord[];
    totalCount: number;
};

type LinkSortField = "created" | "title";

export interface LinksDetailViewProps {
    title: string;
    description?: string;
    listId: string;
    folders: LinkFolderRecord[];
    items: LinkItemRecord[];
    tags: LinkTagRecord[];
    onAddLink?: () => void;
    onFolderCreated?: (folder: LinkFolderRecord) => void;
}

function normalizeTagIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object" && "id" in entry) {
                return String((entry as { id?: unknown }).id ?? "");
            }
            return "";
        })
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function hasAnyTag(value: unknown, tagId: string) {
    return normalizeTagIds(value).includes(tagId);
}

function formatClock(date: Date) {
    return date
        .toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
        })
        .replace(/\s+/g, "");
}

export function formatAddedAt(isoDate?: string) {
    if (!isoDate) return "Date unavailable";

    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "Date unavailable";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffSeconds < 60) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const isYesterday =
        date.getDate() === yesterday.getDate()
        && date.getMonth() === yesterday.getMonth()
        && date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
        return `yesterday at ${formatClock(date)}`;
    }

    if (date.getFullYear() === now.getFullYear()) {
        return `${date.toLocaleDateString([], {
            month: "short",
            day: "2-digit",
        })} at ${formatClock(date)}`;
    }

    return `${date.toLocaleDateString([], {
        month: "short",
        day: "2-digit",
        year: "numeric",
    })} at ${formatClock(date)}`;
}

function compareDates(left?: string, right?: string) {
    const leftTime = left ? new Date(left).getTime() : 0;
    const rightTime = right ? new Date(right).getTime() : 0;
    return leftTime - rightTime;
}

function getLinkIconSource(item: LinkItemRecord) {
    if (item.iconUrl && String(item.iconUrl).trim()) {
        return item.iconUrl;
    }

    try {
        const url = new URL(item.url.includes("//") ? item.url : `https://${item.url}`);
        return `https://www.google.com/s2/favicons?sz=128&domain=${url.hostname}`;
    } catch {
        return "fa6-solid:link";
    }
}

function getFolderIconSource(folder: LinkFolderRecord) {
    if (folder.icon && String(folder.icon).trim()) {
        return folder.icon;
    }

    return "fa6-solid:folder";
}

function TagBadges({
    tagIds,
    tagsById,
}: {
    tagIds?: unknown;
    tagsById: Map<string, LinkTagRecord>;
}) {
    const resolvedTags = normalizeTagIds(tagIds)
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is LinkTagRecord => Boolean(tag));

    if (resolvedTags.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5">
            {resolvedTags.map((tag) => (
                <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/75"
                    style={tag.color ? { borderColor: tag.color } : undefined}
                >
                    <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: tag.color || "rgba(255,255,255,0.45)" }}
                    />
                    <span>{tag.name}</span>
                </span>
            ))}
        </div>
    );
}

function LinkActions({ item, onShare }: { item: LinkItemRecord; onShare: () => void }) {
    const linkUrl = String(item.url ?? "").trim();

    return (
        <div className="flex items-center gap-1 opacity-0 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0 translate-x-1">
            {linkUrl ? (
                <a
                    href={linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={`Open ${item.title}`}
                    title="Fullscreen"
                >
                    <Icon icon="fa6-solid:up-right-from-square" className="text-[11px]" />
                </a>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={`Open ${item.title}`}
                    title="Fullscreen"
                >
                    <Icon icon="fa6-solid:up-right-from-square" className="text-[11px]" />
                </button>
            )}

            <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={`Edit tags for ${item.title}`}
                title="Tag"
            >
                <Icon icon="fa6-solid:tag" className="text-[11px]" />
            </button>

            <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={`Edit ${item.title}`}
                title="Edit"
            >
                <Icon icon="fa6-solid:pen" className="text-[11px]" />
            </button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/15 text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label={`More actions for ${item.title}`}
                        title="More"
                    >
                        <Icon icon="fa6-solid:ellipsis" className="text-[11px]" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="frosted text-foreground min-w-40">
                    <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onShare(); }} className="cursor-pointer">
                        <Icon icon="fa6-solid:share-nodes" className="text-sm" />
                        Share QR code
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={(event) => {
                            event.preventDefault();
                        }}
                        variant="destructive"
                        className="cursor-pointer"
                    >
                        <Icon icon="fa6-solid:trash" className="text-sm" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

function LinkRow({
    item,
    tagsById,
    compact = false,
    onShare,
}: {
    item: LinkItemRecord;
    tagsById: Map<string, LinkTagRecord>;
    compact?: boolean;
    onShare: (item: LinkItemRecord) => void;
}) {
    const linkUrl = String(item.url ?? "").trim();
    const titleElement = linkUrl ? (
        <a
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="wrap-break-word text-base font-medium text-white transition-colors hover:text-primary"
        >
            {item.title || linkUrl}
        </a>
    ) : (
        <span className="wrap-break-word text-base font-medium text-white">{item.title || "-- link --"}</span>
    );

    return (
        <div
            className={`group relative p-1 flex items-center gap-3 rounded-2xl border border-transparent bg-transparent transition-colors hover:border-white/10 hover:bg-white/10 ${compact ? "" : ""}`}
        >
            <div className="shrink-0 pt-0.5">
                <AppIcon
                    source={getLinkIconSource(item)}
                    alt={item.title}
                    className="h-9 w-9 rounded-xl text-white/70"
                    monoClassName="bg-white/75"
                    imageClassName="rounded-xl object-contain"
                />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {titleElement}
                            <TagBadges tagIds={item.tags} tagsById={tagsById} />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
                            <span className="break-all">{linkUrl || "-- link --"}</span>
                            <span className="text-white/25">•</span>
                            <span>{formatAddedAt(item.created)}</span>
                        </div>

                        {item.description ? (
                            <p className="max-w-4xl text-sm leading-6 text-white/60">
                                {item.description}
                            </p>
                        ) : null}
                    </div>

                    <LinkActions item={item} onShare={() => onShare(item)} />
                </div>
            </div>
        </div>
    );
}

function buildFolderForest(folders: LinkFolderRecord[], items: LinkItemRecord[]) {
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const childFoldersByParent = new Map<string, LinkFolderRecord[]>();
    const itemsByFolder = new Map<string, LinkItemRecord[]>();
    const rootItems = items.filter((item) => !item.folder || !folderById.has(item.folder));

    for (const folder of folders) {
        const parentKey = folder.parentFolder && folderById.has(folder.parentFolder)
            ? folder.parentFolder
            : "";
        const childFolders = childFoldersByParent.get(parentKey) ?? [];
        childFolders.push(folder);
        childFoldersByParent.set(parentKey, childFolders);
    }

    for (const item of items) {
        if (!item.folder || !folderById.has(item.folder)) continue;
        const current = itemsByFolder.get(item.folder) ?? [];
        current.push(item);
        itemsByFolder.set(item.folder, current);
    }

    const sortFolders = (entries: LinkFolderRecord[]) => [...entries].sort((left, right) => left.name.localeCompare(right.name));
    const sortItems = (entries: LinkItemRecord[]) => [...entries].sort((left, right) => {
        const dateCompare = compareDates(right.created, left.created);
        if (dateCompare !== 0) return dateCompare;
        return left.title.localeCompare(right.title);
    });

    const buildNode = (folder: LinkFolderRecord): FolderNode => {
        const children = sortFolders(childFoldersByParent.get(folder.id) ?? []).map(buildNode);
        const directItems = sortItems(itemsByFolder.get(folder.id) ?? []);
        const totalCount = directItems.length + children.reduce((sum, child) => sum + child.totalCount, 0);

        return {
            folder,
            children,
            items: directItems,
            totalCount,
        };
    };

    const roots = sortFolders(childFoldersByParent.get("") ?? []).map(buildNode);

    return { roots, rootItems: sortItems(rootItems) };
}

function FolderTreeNode({
    node,
    tagsById,
    collapsedFolders,
    setCollapsedFolders,
    onShare,
    onCreateFolder,
}: {
    node: FolderNode;
    tagsById: Map<string, LinkTagRecord>;
    collapsedFolders: Record<string, boolean>;
    setCollapsedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
    onShare: (item: LinkItemRecord) => void;
    onCreateFolder?: (parentFolderId: string) => void;
}) {
    const isCollapsed = collapsedFolders[node.folder.id] ?? false;
    const canCollapse = node.children.length > 0 || node.items.length > 0;

    return (
        <div className="group rounded-2xl border border-transparent bg-transparent p-2 transition-color">
            <div className="flex items-start gap-3">
                <button
                    type="button"
                    onClick={canCollapse ? () => setCollapsedFolders((current) => ({
                        ...current,
                        [node.folder.id]: !isCollapsed,
                    })) : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8 text-white/70">
                        <AppIcon
                            source={getFolderIconSource(node.folder)}
                            alt={node.folder.name}
                            className="h-5 w-5"
                            monoClassName="bg-white/70"
                            imageClassName="object-contain"
                        />
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-1">
                           
                            <span className="wrap-break-word text-base font-semibold text-white">{node.folder.name}</span>
                            <span className="text-xs text-white/45">
                                ({node.totalCount} {node.totalCount === 1 ? "item" : "items"})
                            </span>
                            <TagBadges tagIds={node.folder.tags} tagsById={tagsById} />
                            {canCollapse ? (
                                <Icon
                                    icon="fa6-solid:chevron-right"
                                    className={`text-[10px] text-white/40 transition-transform duration-200 ${isCollapsed ? "rotate-0" : "rotate-90"}`}
                                />
                            ) : (
                                <span className="mt-1 w-3" aria-hidden />
                            )}
                        </div>
                    </div>
                </button>

                {onCreateFolder ? (
                    <button
                        type="button"
                        onClick={() => onCreateFolder(node.folder.id)}
                        className="ml-auto opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 rounded-full border border-white/10 bg-white/5 p-2 text-white/70 hover:bg-white/10"
                        aria-label={`Create folder under ${node.folder.name}`}
                        title="Create subfolder"
                    >
                        <Icon icon="fa6-solid:plus" className="text-[11px]" />
                    </button>
                ) : null}
            </div>

            {!isCollapsed && (
                <div className="space-y-3 border-l border-white/10 pl-4">
                    {node.children.map((child) => (
                        <FolderTreeNode
                            key={child.folder.id}
                            node={child}
                            tagsById={tagsById}
                            collapsedFolders={collapsedFolders}
                            setCollapsedFolders={setCollapsedFolders}
                            onShare={onShare}
                            onCreateFolder={onCreateFolder}
                        />
                    ))}

                    {node.items.map((item) => (
                        <LinkRow
                            key={item.id}
                            item={item}
                            tagsById={tagsById}
                            compact
                            onShare={onShare}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function LinksDetailView({
    title,
    description,
    listId,
    folders,
    items,
    tags,
    onAddLink,
    onFolderCreated,
}: LinksDetailViewProps) {
    const [sortField, setSortField] = useState<LinkSortField>("created");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const [shareItem, setShareItem] = useState<LinkItemRecord | null>(null);
    const [shareQrDataUrl, setShareQrDataUrl] = useState("");
    const [shareQrLoading, setShareQrLoading] = useState(false);
    const [shareQrError, setShareQrError] = useState<string | null>(null);
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);

    const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

    const { roots, rootItems } = useMemo(
        () => buildFolderForest(folders, items),
        [folders, items],
    );

    const sortedLinks = useMemo(() => {
        const sorted = [...rootItems].sort((left, right) => {
            if (sortField === "title") {
                return left.title.localeCompare(right.title);
            }

            const createdCompare = compareDates(left.created, right.created);
            if (createdCompare !== 0) return createdCompare;
            return left.title.localeCompare(right.title);
        });

        return sortDirection === "asc" ? sorted : sorted.reverse();
    }, [rootItems, sortDirection, sortField]);

    const folderCount = folders.length;
    const linkCount = rootItems.length;

    useEffect(() => {
        if (!shareItem) {
            setShareQrDataUrl("");
            setShareQrError(null);
            setShareQrLoading(false);
            return;
        }

        let cancelled = false;
        const shareUrl = String(shareItem.url ?? "").trim();

        if (!shareUrl) {
            setShareQrDataUrl("");
            setShareQrError("This link has no URL to encode.");
            setShareQrLoading(false);
            return;
        }

        setShareQrLoading(true);
        setShareQrError(null);

        void QRCode.toDataURL(shareUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            scale: 8,
        })
            .then((dataUrl) => {
                if (!cancelled) {
                    setShareQrDataUrl(dataUrl);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setShareQrError(error instanceof Error ? error.message : String(error));
                    setShareQrDataUrl("");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setShareQrLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [shareItem]);

    const copyShareUrl = async () => {
        const shareUrl = String(shareItem?.url ?? "").trim();
        if (!shareUrl) return;

        try {
            await navigator.clipboard.writeText(shareUrl);
        } catch {
            // Ignore clipboard failures; the QR remains available.
        }
    };

    return (
        <div className="relative space-y-1 pb-24">
            <header className="space-y-3">
                <div className="space-y-2">
                    <h1 className="text-4xl font-semibold tracking-tight text-balance text-white">
                        {title}
                    </h1>
                    {description ? (
                        <p className="max-w-4xl text-sm leading-6 text-white/60">
                            {description}
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-white/40">
                    <span>{folderCount} {folderCount === 1 ? "folder" : "folders"}</span>
                    <span className="text-white/20">•</span>
                    <span>{linkCount} {linkCount === 1 ? "link" : "links"}</span>
                </div>
            </header>

            <section className="space-y-1 pt-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-white/90">Folders</h2>
                    <button
                        type="button"
                        onClick={() => {
                            setCreateFolderParentId(null);
                            setCreateFolderOpen(true);
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
                        aria-label="Create folder"
                        title="Create folder"
                    >
                        <Icon icon="fa6-solid:plus" className="text-sm" />
                    </button>
                </div>

                {roots.length === 0 && rootItems.length === 0 ? (
                    <div className="frosted rounded-2xl border border-white/10 p-5 text-sm text-white/55">
                        No folders found.
                    </div>
                ) : (
                    <div className="space-y-1">
                        {roots.map((node) => (
                            <FolderTreeNode
                                key={node.folder.id}
                                node={node}
                                tagsById={tagsById}
                                collapsedFolders={collapsedFolders}
                                setCollapsedFolders={setCollapsedFolders}
                                onShare={(item) => setShareItem(item)}
                                onCreateFolder={(parentFolderId) => {
                                    setCreateFolderParentId(parentFolderId);
                                    setCreateFolderOpen(true);
                                }}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-1">
                <div className="flex flex-wrap items-center justify-between">
                    <h2 className="text-lg font-medium text-white/90">Links</h2>

                    <div className="flex items-center gap-2 rounded-full text-sm text-white/70">
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-1.5">
                            <select
                                value={sortField}
                                onChange={(event) => setSortField(event.target.value as LinkSortField)}
                                className="min-w-34 bg-transparent text-sm text-white outline-none"
                                aria-label="Sort links"
                            >
                                <option value="created">Date added</option>
                                <option value="title">Title</option>
                            </select>

                            <button
                                type="button"
                                onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 "
                                aria-label={`Sort ${sortDirection === "asc" ? "ascending" : "descending"}`}
                                title={sortDirection === "asc" ? "Ascending" : "Descending"}
                            >
                                <Icon
                                    icon={sortDirection === "asc" ? "fa6-solid:arrow-up-short-wide" : "fa6-solid:arrow-down-short-wide"}
                                    className="text-[11px]"
                                />
                            </button>
                        </div>
                    </div>
                </div>

                {sortedLinks.length === 0 ? (
                    <div className="frosted rounded-2xl border border-white/10 p-5 text-sm text-white/55">
                        No links found.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {sortedLinks.map((item) => (
                            <LinkRow
                                key={item.id}
                                item={item}
                                tagsById={tagsById}
                                onShare={(nextItem) => setShareItem(nextItem)}
                            />
                        ))}
                    </div>
                )}
            </section>

            {onAddLink ? (
                <button
                    type="button"
                    onClick={onAddLink}
                    className="fixed bottom-6 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-2xl backdrop-blur-md transition-transform duration-150 hover:scale-105 hover:bg-white/15 hover:text-primary"
                    aria-label="Add link"
                    title="Add link"
                >
                    <Icon icon="fa6-solid:plus" className="text-lg" />
                </button>
            ) : null}

            <CreateLinksFolderDialog
                open={createFolderOpen}
                onOpenChange={(open) => {
                    setCreateFolderOpen(open);
                    if (!open) setCreateFolderParentId(null);
                }}
                listId={listId}
                parentFolderId={createFolderParentId ?? undefined}
                onCreated={(folder) => {
                    onFolderCreated?.(folder);
                    setCreateFolderOpen(false);
                    setCreateFolderParentId(null);
                }}
            />

            <Dialog open={Boolean(shareItem)} onOpenChange={(open) => !open && setShareItem(null)}>
                <DialogContent className="frosted text-foreground max-w-md">
                    <DialogHeader>
                        <DialogTitle>Share link</DialogTitle>
                    </DialogHeader>

                    {shareItem ? (
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <p className="text-lg font-semibold text-white">{shareItem.title}</p>
                                <p className="break-all text-sm text-white/60">{String(shareItem.url ?? "")}</p>
                            </div>

                            <div className="flex items-center justify-center rounded-3xl border border-white/10 bg-black/20 p-4">
                                {shareQrLoading ? (
                                    <div className="text-sm text-white/55">Generating QR code...</div>
                                ) : shareQrError ? (
                                    <div className="max-w-xs text-center text-sm text-red-300">{shareQrError}</div>
                                ) : shareQrDataUrl ? (
                                    <img
                                        src={shareQrDataUrl}
                                        alt={`QR code for ${shareItem.title}`}
                                        className="h-56 w-56 rounded-2xl bg-white p-3"
                                    />
                                ) : null}
                            </div>

                            <div className="flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={copyShareUrl}
                                    className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
                                >
                                    Copy URL
                                </button>
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}