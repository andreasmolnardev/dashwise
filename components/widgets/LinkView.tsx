"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";
import { getMonitoringStatusAction } from "@/app/actions/monitoring";
import { getHomeLinksAction } from "@/app/actions/links";
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
import { set } from "date-fns";

export interface LinkType {
  id?: string;
  title?: string;
  url?: string;
  iconUrl?: string;
  collection?: string;
  folder?: string;
  statusCheck?: boolean;
}
export default function LinkView({ links = [] }: { links?: LinkType[] }) {
  const { config } = usePageConfig();
  const { token, withAuth } = useAuth();
  const [localLinks, setLocalLinks] = useState<LinkType[]>(links);

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
    | { type: "folder"; name: string; links: LinkType[] };

  const items: Item[] = [];

  for (const l of visibleLinks) {
    if (l.folder) {
      if (!emittedFolders.has(l.folder)) {
        const children = visibleLinks.filter((x) => x.folder === l.folder);
        items.push({ type: "folder", name: l.folder, links: children });
        emittedFolders.add(l.folder);
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
                config={config}
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
            <Popover key={folder.name + itemIdx}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full"
                  aria-label={`Open folder ${folder.name}`}
                  title={folder.name}
                >
                    <div className="h-[35px] w-[35px] flex items-center justify-center text-white/80 group-hover:text-white transition-colors">
                    <Icon icon="fa6-solid:folder" className="h-6 w-6" />
                  </div>

                  <div className="flex items-center w-full justify-center">
                    <span className="text-sm text-white truncate px-1">
                      {folder.name}
                    </span>
                  </div>
                </button>
              </PopoverTrigger>

              <PopoverContent className="w-[350px] frosted text-foreground space-y-2">
                <header className="flex justify-between items-center">
                  <h4 className="font-semibold mb-2">{folder.name}</h4>
                  <PopoverClose asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <Icon icon="fa6-solid:xmark" />
                    </Button>
                  </PopoverClose>
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
                        config={config}
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
  config: any;
  monitoringDetails: any;
  setOpenDialogFor: (id: string) => void;
  setEditingLink: (link: LinkType) => void;
  itemIdx?: number;
}

function LinkTile({
  link,
  config,
  monitoringDetails,
  setOpenDialogFor,
  setEditingLink,
  itemIdx,
}: LinkTileProps) {
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
      target={config?.global?.linkOpenBehaviour === "newtab"
        ? "_blank"
        : "_self"}
      rel={config?.global?.linkOpenBehaviour === "newtab"
        ? "noopener noreferrer"
        : undefined}
      className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full"
    >
      {link.iconUrl
        ? (
          <img
            src={link.iconUrl}
            alt={link.title ?? "Icon"}
            className="h-[35px] w-[35px] object-contain rounded-lg bg-white/5"
          />
        )
        : (
          <div className="h-[35px] w-[35px] flex items-center justify-center">
            <Icon icon="fa6-solid:folder" className="h-6 w-6 opacity-20" />
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
            <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditingLink(link);
          }}
          className="p-1.5 aspect-square hidden group-hover:flex transition-all items-center rounded-full text-white/50 hover:text-white absolute right-0 bottom-0"
          title="Edit link"
        >
          <Icon icon="fa6-solid:edit" className="h-3 w-3" />
        </button>
      </div>
    </a>
  );
}
