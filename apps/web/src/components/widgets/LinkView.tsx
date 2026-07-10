"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/useAuth";
import { getMonitoringStatusAction } from '@/lib/apiClient';
import {
  getHomeLinksAction,
  updateHomeLinkFolderIconAction,
} from '@/lib/apiClient';
import { PaginatedCarouselViewComponent } from "./PaginatedCarouselView";
import type { LinkType } from "@dashwise/types/sdk";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@iconify-icon/react";
import { PopoverClose } from "@radix-ui/react-popover";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LinkDetailsForm from "@/components/settings/LinkDetailsForm";
import IconPickerComponent from "@/components/settings/IconPicker";
import AppIcon from "@dashwise/app-icon";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { updateLinksOrderAction } from '@/lib/apiClient';

const HOME_LINKS_CACHE_PREFIX = "dashwise_home_links_cache_v1";
const DEFAULT_LINK_GROUP = "Default";

type Item =
  | { type: "link"; link: LinkType }
  | {
    type: "folder";
    key: string;
    recordId?: string;
    name: string;
    icon?: string;
    links: LinkType[];
  };

function getHomeLinksCacheKey(userId: string | null | undefined) {
  return userId ? `${HOME_LINKS_CACHE_PREFIX}:${userId}` : null;
}

function readCachedHomeLinks(userId: string | null | undefined): LinkType[] | null {
  if (typeof window === "undefined") return null;

  const cacheKey = getHomeLinksCacheKey(userId);
  if (!cacheKey) return null;

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LinkType[];
    if (Array.isArray(parsed?.links)) return parsed.links as LinkType[];
  } catch {
    // ignore cache parse failures and fall back to server data
  }

  return null;
}

function writeCachedHomeLinks(userId: string | null | undefined, links: LinkType[]) {
  if (typeof window === "undefined") return;

  const cacheKey = getHomeLinksCacheKey(userId);
  if (!cacheKey) return;

  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({ links, updatedAt: Date.now() }),
    );
  } catch {
    // ignore storage failures
  }
}

function getLinkSortLabel(link: LinkType): string {
  return String(link.title || link.name || link.url || "").trim().toLowerCase();
}

function getLinkSortPosition(link: LinkType): number | null {
  return typeof link.position === "number" && Number.isFinite(link.position)
    ? link.position
    : null;
}

function getLinkGroupName(link: LinkType): string {
  return String(link.collection || link.linkGroup || "").trim() || DEFAULT_LINK_GROUP;
}

function isTruthyQueryValue(value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();

  return normalized === "" || !["0", "false", "no", "off"].includes(normalized);
}

function sortLinksForDisplay(links: LinkType[]): LinkType[] {
  return [...links].sort((left, right) => {
    const leftPosition = getLinkSortPosition(left);
    const rightPosition = getLinkSortPosition(right);

    if (leftPosition !== null || rightPosition !== null) {
      if (leftPosition === null) return 1;
      if (rightPosition === null) return -1;
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    }

    const leftLabel = getLinkSortLabel(left);
    const rightLabel = getLinkSortLabel(right);

    if (leftLabel !== rightLabel) {
      return leftLabel.localeCompare(rightLabel);
    }

    return String(left.id || left.url || "").localeCompare(String(right.id || right.url || ""));
  });
}

function applyOptimisticLinkOrder(
  prevLinks: LinkType[],
  reorderedVisibleLinks: LinkType[],
  activeCollection: string | null,
): LinkType[] {
  if (!reorderedVisibleLinks.length) return prevLinks;

  if (!activeCollection) {
    return reorderedVisibleLinks.map((link, position) => ({
      ...link,
      position,
    }));
  }

  const sortedPrevLinks = sortLinksForDisplay(prevLinks);
  const visibleSlots: number[] = [];

  sortedPrevLinks.forEach((link, index) => {
    if (getLinkGroupName(link) === activeCollection) {
      visibleSlots.push(index);
    }
  });

  if (!visibleSlots.length) return prevLinks;

  const nextBySlot = new Map<number, LinkType>();

  visibleSlots.forEach((slot, index) => {
    const reorderedLink = reorderedVisibleLinks[index];
    if (!reorderedLink) return;

    nextBySlot.set(slot, {
      ...reorderedLink,
      position: slot,
    });
  });

  return sortedPrevLinks.map((link, index) => nextBySlot.get(index) ?? link);
}

export default function LinkView({ links = [] }: { links?: LinkType[] }) {
  const { token, user, withAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [localLinks, setLocalLinks] = useState<LinkType[]>(() => {
    if (links.length > 0) return links;
    return readCachedHomeLinks(user?.id) ?? links;
  });

  const [, setFolderPreviewRev] = useState(0);

  const toggleFolderPreview = React.useCallback((folderId: string) => {
    if (!folderId) return;
    try {
      const key = `folderPreviewMode#${folderId}`;
      if (window.localStorage.getItem(key) === "preview-first") {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, "preview-first");
      }
    } catch {
      // ignore storage failures
    }
    setFolderPreviewRev((value) => value + 1);
  }, []);

  useEffect(() => {
    setLocalLinks(readCachedHomeLinks(user?.id) ?? links);

    const fetchLinks = async () => {
      try {
        const data = await withAuth((auth) => getHomeLinksAction(auth));
        if (Array.isArray(data)) {
          const nextLinks = data as LinkType[];
          setLocalLinks(nextLinks);
          writeCachedHomeLinks(user?.id, nextLinks);
        }
      } catch (err) {
        console.error("Failed to fetch home links:", err);
      }
    };

    fetchLinks();
  }, [user?.id, withAuth]);

  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  const collections = useMemo(
    () => [...new Set(localLinks.map(getLinkGroupName))],
    [localLinks],
  );

  const sortedLinks = useMemo(() => sortLinksForDisplay(localLinks), [localLinks]);

  const visibleLinks = useMemo(
    () => (activeCollection
      ? sortedLinks.filter((link) => getLinkGroupName(link) === activeCollection)
      : sortedLinks),
    [sortedLinks, activeCollection],
  );

  useEffect(() => {
    if (!collections.length) {
      setActiveCollection(null);
      return;
    }

    if (!activeCollection || !collections.includes(activeCollection)) {
      setActiveCollection(collections[0]);
    }
  }, [collections, activeCollection]);

  const emittedFolders = new Set<string>();
  const items: Item[] = [];

  for (const link of visibleLinks) {
    const folderKey = link.folderId || link.folder;
    if (folderKey) {
      if (!emittedFolders.has(folderKey)) {
        const children = visibleLinks.filter((candidate) =>
          (candidate.folderId || candidate.folder) === folderKey
        );
        items.push({
          type: "folder",
          key: folderKey,
          recordId: link.folderId,
          name: link.folder || folderKey,
          icon: link.folderIcon,
          links: children,
        });
        emittedFolders.add(folderKey);
      }
    } else {
      items.push({ type: "link", link });
    }
  }

  const [, setStatusMap] = useState<Record<string, boolean>>({});
  const [monitoringDetails, setMonitoringDetails] = useState<
    Record<string, {
      status: string;
      dateChanged: string | null;
      durationChanged: number | null;
      endpoint?: string;
    }> | null
  >(null);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkType | null>(null);
  const [editingFolder, setEditingFolder] = useState<
    {
      id: string;
      name: string;
      icon?: string;
    } | null
  >(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (isTruthyQueryValue(search.get("addLink"))) {
      setIsAddDialogOpen(true);
    }
  }, [location.search]);

  function serverStatusToBool(status?: string | null): boolean | undefined {
    if (status === undefined || status === null) return undefined;
    if (status === "healthy") return true;
    if (status === "disabled") return undefined;
    return false;
  }

  const fetchMonitoringStatuses = React.useCallback(async () => {
    try {
      if (typeof window === "undefined") return;
      if (!token) {
        setMonitoringDetails(null);
        setStatusMap({});
        return;
      }

      let data: any = null;
      try {
        data = await withAuth((auth) => getMonitoringStatusAction(auth));
      } catch (err) {
        console.warn("/api/v1/monitoringStatus error:", err);
        return;
      }

      const normalized: Record<string, any> = {};
      for (const [rawKey, entry] of Object.entries(data || {})) {
        const keyStr = String(rawKey);
        if (keyStr.startsWith("link ")) {
          const id = keyStr.slice(5);
          normalized[id] = entry;
        } else {
          normalized[rawKey] = entry;
        }
      }

      setMonitoringDetails(normalized);

      const next: Record<string, boolean> = {};
      for (const [linkId, entry] of Object.entries(normalized)) {
        next[linkId] = serverStatusToBool((entry as any).status) as boolean;
      }
      setStatusMap(next);
    } catch (err) {
      console.error("Failed to fetch monitoring statuses:", err);
    }
  }, [token, withAuth]);

  useEffect(() => {
    let mounted = true;
    fetchMonitoringStatuses();

    const id = window.setInterval(() => {
      if (!mounted) return;
      fetchMonitoringStatuses();
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [fetchMonitoringStatuses]);

  const refreshHomeLinks = React.useCallback(async () => {
    try {
      const data = await withAuth((auth) => getHomeLinksAction(auth));
      if (Array.isArray(data)) {
        const nextLinks = data as LinkType[];
        setLocalLinks(nextLinks);
        writeCachedHomeLinks(user?.id, nextLinks);
      }
    } catch (err) {
      console.error("Failed to refresh home links:", err);
    }
  }, [user?.id, withAuth]);

  const handleOptimisticSave = React.useCallback(
    (
      draft: {
        id: string;
        title: string;
        url: string;
        iconUrl: string;
        collection: string;
        folder?: string;
        statusCheck?: boolean;
      },
      mode: "create" | "update",
    ) => {
      let rollback: () => void = () => undefined;

      setLocalLinks((prev) => {
        if (mode === "update") {
          const previous = prev.find((link) => link.id === draft.id);
          if (previous) {
            rollback = () => {
              setLocalLinks((current) =>
                current.map((link) => (link.id === previous.id ? previous : link))
              );
            };

            const nextLinks = prev.map((link) =>
              link.id === draft.id
                ? {
                  ...link,
                  title: draft.title,
                  url: draft.url,
                  iconUrl: draft.iconUrl,
                  collection: draft.collection,
                  folder: draft.folder,
                  statusCheck: draft.statusCheck,
                }
                : link
            );

            writeCachedHomeLinks(user?.id, nextLinks);
            return nextLinks;
          }
        }

        rollback = () => {
          setLocalLinks((current) => current.filter((link) => link.id !== draft.id));
        };

        const nextLinks = [
          ...prev,
          {
            id: draft.id,
            title: draft.title,
            url: draft.url,
            iconUrl: draft.iconUrl,
            collection: draft.collection,
            folder: draft.folder,
            statusCheck: draft.statusCheck,
          },
        ];

        writeCachedHomeLinks(user?.id, nextLinks);
        return nextLinks;
      });

      return rollback;
    },
    [user?.id],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const getItemId = React.useCallback((item: Item) => {
    return item.type === "link"
      ? `link:${item.link.id || item.link.url || item.link.title}`
      : `folder:${item.key}`;
  }, []);

  const activeDragItem = useMemo(() => {
    if (!activeDragId) return null;
    return items.find((item) => getItemId(item) === activeDragId) ?? null;
  }, [activeDragId, getItemId, items]);

  const reorderVisibleLinks = React.useCallback((reorderedItems: Item[]) => {
    const reorderedVisibleLinks: LinkType[] = [];
    const payload: {
      id: string;
      type: "link" | "folder";
      position: number;
    }[] = [];

    reorderedItems.forEach((item, index) => {
      if (item.type === "link") {
        reorderedVisibleLinks.push(item.link);
        if (item.link.id) {
          payload.push({ id: item.link.id, type: "link", position: index });
        }
        return;
      }

      reorderedVisibleLinks.push(...item.links);
      if (item.recordId) {
        payload.push({ id: item.recordId, type: "folder", position: index });
      }
    });

    return { reorderedVisibleLinks, payload };
  }, []);

  const handleDragStart = React.useCallback((event: { active: { id: string | number } }) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragCancel = React.useCallback(() => {
    setActiveDragId(null);
  }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) =>
        getItemId(item) === active.id
      );
      const newIndex = items.findIndex((item) =>
        getItemId(item) === over.id
      );

      if (oldIndex !== -1 && newIndex !== -1) {
        const newItems = arrayMove(items, oldIndex, newIndex);
        const { reorderedVisibleLinks, payload } = reorderVisibleLinks(newItems);

        setLocalLinks((prev) => {
          const nextLinks = applyOptimisticLinkOrder(
            prev,
            reorderedVisibleLinks,
            activeCollection,
          );

          writeCachedHomeLinks(user?.id, nextLinks);
          return nextLinks;
        });

        try {
          await withAuth((auth) => updateLinksOrderAction(auth, payload));
        } catch (err) {
          console.error("Failed to update links order:", err);
          await refreshHomeLinks();
        }
      }
    }
  };

  const renderItem = React.useCallback(
    (item: Item, itemIdx: number, dragging = false) => {
      if (item.type === "link") {
        return (
          <LinkTile
            key={item.link.id || item.link.url || itemIdx}
            link={item.link}
            monitoringDetails={monitoringDetails}
            setEditingLink={setEditingLink}
            navigate={navigate}
            itemIdx={itemIdx}
            isDragging={dragging}
          />
        );
      }

      const folder = item;
      const folderId = folder.recordId || folder.key;
      const isPreview = previewFirstFolderIcons(folderId);

      return (
        <LinkFolderPopover
          folder={folder}
          monitoringDetails={monitoringDetails}
          setEditingFolder={setEditingFolder}
          setEditingLink={setEditingLink}
          navigate={navigate}
          toggleFolderPreview={toggleFolderPreview}
        />
      );
    },
    [monitoringDetails, navigate, setEditingFolder, setEditingLink, toggleFolderPreview],
  );

  return (
    <div className="space-y-2">
      {collections.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5 flex-wrap">
            {collections.map((col) => (
              <button
                key={col}
                onClick={() => setActiveCollection(col)}
                className={`px-3.5 py-2 rounded-xl font-medium text-sm transition-colors frosted hover:text-primary ${
                  activeCollection === col
                    ? " text-white outline-1 outline-primary"
                    : " text-white/70 hover:text-white"
                }`}
              >
                {col}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="frosted rounded-full hover:text-primary"
            onClick={() => setIsAddDialogOpen(true)}
            title="Add link"
            aria-label="Add link"
          >
            <Icon icon="fa6-solid:plus" />
          </Button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((item) => getItemId(item))}
          strategy={rectSortingStrategy}
        >
          <PaginatedCarouselViewComponent minColWidth={140}>
            {items.map((item, itemIdx) => (
              <SortableTileWrapper key={getItemId(item)} id={getItemId(item)}>
                {renderItem(item, itemIdx)}
              </SortableTileWrapper>
            ))}
          </PaginatedCarouselViewComponent>
        </SortableContext>

        <DragOverlay>
          {activeDragItem ? (
            <div className="pointer-events-none scale-105 rotate-1 opacity-80 shadow-2xl">
              {renderItem(activeDragItem, 0, true)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {items.length === 0 && (
        <Empty className="frosted w-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon icon="fa6-solid:link" />
            </EmptyMedia>
            <EmptyTitle>No links</EmptyTitle>
            <EmptyDescription>No data found</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setIsAddDialogOpen(true)}>Add a link</Button>
          </EmptyContent>
        </Empty>
      )}

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="frosted text-foreground max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Link</DialogTitle>
          </DialogHeader>
          <LinkDetailsForm
            onClose={async () => {
              setIsAddDialogOpen(false);
              await refreshHomeLinks();
            }}
            preselectOpenedGroup={activeCollection ?? collections[0]}
            onOptimisticSave={handleOptimisticSave}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingLink}
        onOpenChange={(open) => !open && setEditingLink(null)}
      >
        <DialogContent className="frosted text-foreground max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Link</DialogTitle>
          </DialogHeader>
          <LinkDetailsForm
            link={editingLink
              ? {
                id: editingLink.id,
                name: editingLink.title,
                url: editingLink.url,
                icon: editingLink.iconUrl,
                linkGroup: editingLink.collection,
                folder: editingLink.folder,
                statusCheck: editingLink.statusCheck,
              }
              : undefined}
            onClose={async () => {
              setEditingLink(null);
              await refreshHomeLinks();
            }}
            onOptimisticSave={handleOptimisticSave}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingFolder}
        onOpenChange={(open) => !open && setEditingFolder(null)}
      >
        <DialogContent className="frosted text-foreground max-w-3xl">
          <DialogHeader>
            <DialogTitle>Change Folder Icon</DialogTitle>
          </DialogHeader>
          {editingFolder && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl py-2">
                {editingFolder.icon
                  ? (
                    <AppIcon
                      source={editingFolder.icon}
                      alt={editingFolder.name}
                      className="text-white/90 h-5 w-5"
                      imageClassName="invert object-contain"
                    />
                  )
                  : (
                    <Icon
                      icon="fa6-solid:folder"
                      className="h-5 w-5 text-white/30"
                    />
                  )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{editingFolder.name}</p>
                </div>
              </div>

              <IconPickerComponent
                onSelect={async (iconObj) => {
                  if (!editingFolder?.id) return;
                  await withAuth((auth) =>
                    updateHomeLinkFolderIconAction(auth, editingFolder.id, {
                      icon: iconObj.url ?? "",
                    })
                  );
                  setLocalLinks((current) => {
                    const nextLinks = current.map((link) =>
                      link.folderId === editingFolder.id
                        ? { ...link, folderIcon: iconObj.url ?? "" }
                        : link
                    );
                    writeCachedHomeLinks(user?.id, nextLinks);
                    return nextLinks;
                  });
                  setEditingFolder((current) =>
                    current ? { ...current, icon: iconObj?.url ?? "" } : current
                  );
                  await refreshHomeLinks();
                  setEditingFolder(null);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function previewFirstFolderIcons(folderId: string): boolean {
  if (!folderId) return false;
  try {
    const mode = window.localStorage.getItem(`folderPreviewMode#${folderId}`);
    if (!mode) return false;
    return mode === "preview-first";
  } catch {
    return false;
  }
}

interface LinkTileProps {
  link: LinkType;
  monitoringDetails: any;
  setEditingLink: (link: LinkType) => void;
  navigate: (to: string) => void;
  itemIdx?: number;
  isDragging?: boolean;
}

function LinkTile({
  link,
  monitoringDetails,
  setEditingLink,
  navigate,
  itemIdx,
  isDragging,
}: LinkTileProps) {
  const { user } = useAuth();
  const serverEntry = link.id && monitoringDetails
    ? monitoringDetails[link.id]
    : undefined;
  const serverStatus = serverEntry?.status;
  const isHealthy = serverStatus === "healthy";
  const isDisabled = serverStatus === "disabled";
  const showDot = Boolean(link.statusCheck);

  return (
    <a
      key={link.id || link.url || itemIdx}
      href={link.url}
      target={user?.global?.linkOpenBehaviour === "newtab" ? "_blank" : "_self"}
      rel={user?.global?.linkOpenBehaviour === "newtab"
        ? "noopener noreferrer"
        : undefined}
      className={`group relative flex flex-col items-center justify-between gap-1 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full ${isDragging ? "opacity-40 ring-1 ring-white/20" : ""}`}
    >
      {link.iconUrl
        ? (
          <AppIcon
            source={link.iconUrl}
            alt={link.title}
            className="aspect-square w-8.75 m-2"
            monoClassName="bg-foreground transition-colors group-hover:bg-primary"
            lazy
          />
        )
        : (
          <div className="h-8.75 w-8.75 flex items-center justify-center">
            <Icon
              icon="fa6-solid:folder"
              className="h-6 w-6 opacity-20 text-[2rem]"
            />
          </div>
        )}

      <div className="flex items-center w-full justify-between relative">
        <div className="flex items-center justify-center flex-1">
          <span className="text-sm text-white truncate px-1">{link.title}</span>

          {showDot && (
            <button
              aria-label={`Show monitoring details for ${link.title}`}
              title={`Show monitoring details for ${link.title}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const monitorId = link.id && monitoringDetails?.[link.id]?.id;
                if (monitorId) {
                  navigate(`/apps/monitoring/${monitorId}`);
                }
              }}
              className="flex items-center justify-center"
            >
              <span
                className="h-2 w-2 rounded-full inline-block hover:cursor-pointer hover:ring-2"
                style={{
                  backgroundColor: isHealthy
                    ? "var(--primary)"
                    : isDisabled
                    ? "#9CA3AF"
                    : "#6B7280",
                }}
                aria-hidden
              />
            </button>
          )}
        </div>
        <Button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditingLink(link);
          }}
          className="frosted absolute right-0 bottom-0 z-10 flex aspect-square items-center justify-center rounded-full p-0.5 text-white/50 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          title="Edit link"
          aria-label={`Edit ${link.title ?? "link"}`}
        >
          <Icon icon="fa6-solid:pen-to-square" className="h-3 w-3" />
        </Button>
      </div>
    </a>
  );
}

function SortableTileWrapper(
  { id, children }: { id: string; children: React.ReactNode },
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="touch-none select-none"
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function LinkFolderPopover({
  folder,
  monitoringDetails,
  setEditingFolder,
  setEditingLink,
  navigate,
  toggleFolderPreview,
}: {
  folder: {
    type: "folder";
    key: string;
    recordId?: string;
    name: string;
    icon?: string;
    links: LinkType[];
  };
  monitoringDetails: any;
  setEditingFolder: (f: { id: string; name: string; icon?: string } | null) => void;
  setEditingLink: (link: LinkType) => void;
  navigate: (to: string) => void;
  toggleFolderPreview: (folderId: string) => void;
}) {
  const folderId = folder.recordId || folder.key;
  const isPreview = previewFirstFolderIcons(folderId);

  return (
    <Popover key={folder.key}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group h-full flex flex-col items-center justify-between frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full group/folderdiv"
          aria-label={`Open folder ${folder.name}`}
          title={folder.name}
        >
          {isPreview && folder.links.length > 0
            ? (
              <div className="flex items-center justify-center gap-1">
                {folder.links.slice(0, 2).map((child, childIdx) => (
                  <div
                    key={child.id || childIdx}
                    className="frosted w-12 aspect-square rounded-lg flex items-center justify-center text-2xl group/icon cursor-pointer"
                    onClick={() =>
                      child.url &&
                      window.open(
                        child.url,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <AppIcon
                      source={child.iconUrl}
                      alt={child.title || ""}
                      className="p-1 h-8 w-5 bg-white group-hover/icon:bg-primary"
                    />
                  </div>
                ))}
                <div className="frosted w-12 aspect-square rounded-lg flex items-center justify-center text-2xl group/icon cursor-pointer">
                  <AppIcon
                    source="fa6-solid:plus"
                    alt={folder.name}
                    className="text-white/90 text-[1rem] group-hover/icon:text-primary"
                    imageClassName="object-contain"
                  />
                </div>
              </div>
            )
            : folder.icon
            ? (
              <AppIcon
                source={folder.icon}
                alt={folder.name}
                className="text-white/90 h-6 p-2 text-[2rem] group-hover:text-primary"
                imageClassName="invert object-contain"
              />
            )
            : (
              <Icon
                icon="fa6-solid:folder"
                className="h-6 w-6 text-[1.5rem] pt-2 group-hover:text-primary"
              />
            )}

          <div className="flex items-center w-full justify-center">
            <span className="text-sm text-white truncate px-1 group-hover/folderdiv:text-primary">
              {folder.name}
            </span>
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-87.5 frosted text-foreground space-y-2">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              disabled={!folder.recordId}
              onClick={() => {
                if (!folder.recordId) return;
                setEditingFolder({
                  id: folder.recordId,
                  name: folder.name,
                  icon: folder?.icon,
                });
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
              title={`Change icon for ${folder.name}`}
              aria-label={`Change icon for ${folder.name}`}
            >
              {folder.icon
                ? (
                  <AppIcon
                    source={folder.icon}
                    alt={folder.name}
                    className="text-white/90 h-5 w-5"
                    imageClassName="invert object-contain"
                  />
                )
                : (
                  <Icon
                    icon="fa6-solid:folder"
                    className="h-5 w-5 text-white/30"
                  />
                )}
            </button>
            <h4 className="font-semibold truncate">{folder.name}</h4>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleFolderPreview(folderId)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              aria-pressed={isPreview}
              aria-label={isPreview
                ? "Hide folder contents preview"
                : "Show folder contents preview"}
              title={isPreview
                ? "Hide folder contents preview"
                : "Show folder contents preview"}
            >
              <AppIcon
                source="glyphs:columns-2-bold"
                className={`h-4 w-4 ${isPreview ? "text-primary" : ""}`}
              />
            </button>
            <PopoverClose asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <Icon icon="fa6-solid:xmark" />
              </Button>
            </PopoverClose>
          </div>
        </header>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          }}
        >
          {folder.links.map((child, childIdx) => (
            <LinkTile
              key={child.id || child.url || childIdx}
              link={child}
              monitoringDetails={monitoringDetails}
              setEditingLink={setEditingLink}
              navigate={navigate}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
