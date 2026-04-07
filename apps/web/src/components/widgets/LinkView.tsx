"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import { useAuth } from "@/context/useAuth";
import { getMonitoringStatusAction } from "@/app/actions/monitoring";
import {
  getHomeLinksAction,
  updateHomeLinkFolderIconAction,
} from "@/app/actions/links";
import { PaginatedCarouselViewComponent } from "./PaginatedCarouselView";
import MonitoringDialog, { JobEntry } from "./MonitoringDialog";
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
import AppIcon from "@/components/shared/AppIcon";

export interface LinkType {
  id?: string;
  title?: string;
  url?: string;
  iconUrl?: string;
  collection?: string;
  collectionId?: string;
  folder?: string;
  folderId?: string;
  folderIcon?: string;
  statusCheck?: boolean;
}

const FOLDER_ICON_CONTENTS_KEY = "dashwise_folder_icon_show_contents";

export default function LinkView({ links = [] }: { links?: LinkType[] }) {
  const { pageConfig } = usePageConfig();
  const { token, withAuth } = useAuth();
  const [localLinks, setLocalLinks] = useState<LinkType[]>(links);
  const [showFolderContents, setShowFolderContents] = useState(false);

  useEffect(() => {
    try {
      setShowFolderContents(
        window.localStorage.getItem(FOLDER_ICON_CONTENTS_KEY) === "1",
      );
    } catch {
      setShowFolderContents(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FOLDER_ICON_CONTENTS_KEY,
        showFolderContents ? "1" : "0",
      );
    } catch {
      // ignore storage failures
    }
  }, [showFolderContents]);

  useEffect(() => {
    const fetchLinks = async () => {
      try {
        const data = await withAuth((auth) => getHomeLinksAction(auth));
        if (Array.isArray(data)) {
          setLocalLinks(data as LinkType[]);
        }
      } catch (err) {
        console.error("Failed to fetch home links:", err);
      }
    };

    fetchLinks();
  }, [withAuth]);

  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  const collections = useMemo(
    () =>
      [
        ...new Set(localLinks.map((l) => l.collection).filter(Boolean)),
      ] as string[],
    [localLinks],
  );

  const visibleLinks = useMemo(
    () => (activeCollection
      ? localLinks.filter((l) => l.collection === activeCollection)
      : localLinks),
    [localLinks, activeCollection],
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

  const items: Item[] = [];

  for (const l of visibleLinks) {
    const folderKey = l.folderId || l.folder;
    if (folderKey) {
      if (!emittedFolders.has(folderKey)) {
        const children = visibleLinks.filter((x) =>
          (x.folderId || x.folder) === folderKey
        );
        items.push({
          type: "folder",
          key: folderKey,
          recordId: l.folderId,
          name: l.folder || folderKey,
          icon: l.folderIcon,
          links: children,
        });
        emittedFolders.add(folderKey);
      }
    } else {
      items.push({ type: "link", link: l });
    }
  }

  const [statusMap, setStatusMap] = useState<Record<string, boolean>>({});

  const [monitoringDetails, setMonitoringDetails] = useState<
    Record<string, {
      status: string;
      dateChanged: string | null;
      durationChanged: number | null;
      endpoint?: string;
    }> | null
  >(null);

  const [openDialogFor, setOpenDialogFor] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkType | null>(null);
  const [editingFolder, setEditingFolder] = useState<
    {
      id: string;
      name: string;
      icon?: string;
    } | null
  >(null);

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

  const selectedLink = openDialogFor
    ? localLinks.find((l: LinkType) => l.id === openDialogFor)
    : undefined;

  const refreshHomeLinks = React.useCallback(async () => {
    try {
      const data = await withAuth((auth) => getHomeLinksAction(auth));
      if (Array.isArray(data)) {
        setLocalLinks(data as LinkType[]);
      }
    } catch (err) {
      console.error("Failed to refresh home links:", err);
    }
  }, [withAuth]);

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
          const previous = prev.find((l) => l.id === draft.id);
          if (previous) {
            rollback = () => {
              setLocalLinks((current) =>
                current.map((l) => (l.id === previous.id ? previous : l))
              );
            };

            return prev.map((l) =>
              l.id === draft.id
                ? {
                  ...l,
                  title: draft.title,
                  url: draft.url,
                  iconUrl: draft.iconUrl,
                  collection: draft.collection,
                  folder: draft.folder,
                  statusCheck: draft.statusCheck,
                }
                : l
            );
          }
        }

        rollback = () => {
          setLocalLinks((current) => current.filter((l) => l.id !== draft.id));
        };

        return [
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
      });

      return rollback;
    },
    [],
  );

  return (
    <div className="space-y-2">
      {/* Collection filter chips */}
      {collections.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2 flex-wrap">
            {collections.map((col) => (
              <button
                key={col}
                onClick={() => setActiveCollection(col)}
                className={`px-3 py-1 rounded-lg font-medium text-sm transition-colors frosted hover:text-primary ${
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
            className="frosted rounded-full"
            onClick={() => setIsAddDialogOpen(true)}
            title="Add link"
            aria-label="Add link"
          >
            <Icon icon="fa6-solid:plus" />
          </Button>
        </div>
      )}

      <PaginatedCarouselViewComponent minColWidth={140}>
        {items.map((item, itemIdx) => {
          if (item.type === "link") {
            return (
              <LinkTile
                key={item.link.id || item.link.url || itemIdx}
                link={item.link}
                monitoringDetails={monitoringDetails}
                setOpenDialogFor={setOpenDialogFor}
                setEditingLink={setEditingLink}
                itemIdx={itemIdx}
              />
            );
          }

          // folder tile (Popover)
          const folder = item;
          return (
            <Popover key={folder.key}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full"
                  aria-label={`Open folder ${folder.name}`}
                  title={folder.name}
                >
                  {folder.icon
                    ? (
                      <AppIcon
                        source={folder.icon}
                        alt={folder.name}
                        className="text-white/90 h-[2rem] text-[2rem] group-hover:text-primary"
                        imageClassName="invert object-contain"
                      />
                    )
                    : (
                      <Icon
                        icon="fa6-solid:folder"
                        className="h-5 w-5 text-white/30 group-hover:text-primary"
                      />
                    )}

                  <div className="flex items-center w-full justify-center">
                    <span className="text-sm text-white truncate px-1">
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
                      onClick={() =>
                        setShowFolderContents((current) => !current)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg  transition-colors`}
                      aria-pressed={showFolderContents}
                      aria-label={showFolderContents
                        ? "Hide folder contents preview"
                        : "Show folder contents preview"}
                      title={showFolderContents
                        ? "Hide folder contents preview"
                        : "Show folder contents preview"}
                    >
                      <AppIcon
                        source="glyphs:columns-2-bold"
                        className={`h-4 w-4 ${
                          showFolderContents ? "text-primary" : ""
                        }`}
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
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(120px, 1fr))",
                  }}
                >
                  {folder.links.map((child, childIdx) => {
                    const serverEntry = child.id && monitoringDetails
                      ? monitoringDetails[child.id]
                      : undefined;
                    const serverStatus = serverEntry?.status;
                    const isHealthy = serverStatus === "healthy";
                    const isDisabled = serverStatus === "disabled";
                    const showDot = Boolean(child.statusCheck);

                    return (
                      <LinkTile
                        key={child.id || child.url || childIdx}
                        link={child}
                        monitoringDetails={monitoringDetails}
                        setOpenDialogFor={setOpenDialogFor}
                        setEditingLink={setEditingLink}
                      />
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
      </PaginatedCarouselViewComponent>

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
                {editingFolder.icon ? (
                    <AppIcon
                      source={editingFolder.icon}
                      alt={editingFolder.name}
                      className="text-white/90 h-5 w-5"
                      imageClassName="invert object-contain"
                    />
                  ) : (
                      <Icon icon="fa6-solid:folder" className="h-5 w-5 text-white/30" />
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
                  setLocalLinks((current) =>
                    current.map((link) =>
                      link.folderId === editingFolder.id
                        ? { ...link, folderIcon: iconObj.url ?? "" }
                        : link
                    )
                  );
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

      {selectedLink && (
        <MonitoringDialog
          open={!!selectedLink}
          onOpenChange={(val) => {
            if (!val) setOpenDialogFor(null);
          }}
          link={selectedLink}
          onCheckTriggered={fetchMonitoringStatuses}
          details={selectedLink.id && monitoringDetails
            ? (monitoringDetails[selectedLink.id] as JobEntry)
            : undefined}
        />
      )}
    </div>
  );
}

interface LinkTileProps {
  link: LinkType;
  monitoringDetails: any;
  setOpenDialogFor: (id: string) => void;
  setEditingLink: (link: LinkType) => void;
  itemIdx?: number;
}

function LinkTile({
  link,
  monitoringDetails,
  setOpenDialogFor,
  setEditingLink,
  itemIdx,
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
      className="group relative flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full"
    >
      {link.iconUrl
        ? (
          <AppIcon
            source={link.iconUrl}
            alt={link.title}
            className="h-8.75 w-8.75 text-foreground transition-colors group-hover:text-primary"
            imageClassName="object-contain"
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
                if (
                  link.id && monitoringDetails && monitoringDetails[link.id]
                ) {
                  setOpenDialogFor(link.id);
                }
              }}
              className="ml-2 flex items-center justify-center"
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
