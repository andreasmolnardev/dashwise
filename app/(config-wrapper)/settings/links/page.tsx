"use client";

import React, { useEffect, useState } from "react";
import { useConfig } from "@/context/ConfigContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@radix-ui/react-label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";


import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faBroom, faCaretRight, faPlusCircle, faTrash } from "@fortawesome/free-solid-svg-icons";
import LinkDetailsForm from "@/components/settings/LinkDetailsForm";
import CreateLinkGroupDialog from "@/components/settings/CreateLinkGroupDialog";
import DeleteUnusedLinkGroupsFormComponent from "@/components/settings/DeleteUnusedLinkGroupsForm";
import MoveLinkGroupsFormComponent from "@/components/settings/MoveLinkGroupsForm";

type LinkItem = {
  id?: string;
  name: string;
  url: string;
  icon?: string;
  linkGroup?: string;
};

export default function LinksSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<string>("");

  const baseLinkGroups = config?.linkGroups || [];
  const linkGroups = [...baseLinkGroups, "+ Add new"];

  const [selectMode, setSelectMode] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // local list state for immediate frontend moves
  const [localLinks, setLocalLinks] = useState<LinkItem[]>([]);

  // edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null);

  // drag state
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null);
  // insertion index where the drop will insert the dragged item
  const [dropIndex, setDropIndex] = useState<number | null>(null);


  useEffect(() => {
    if (!selectedGroup && Array.isArray(config?.linkGroups) && config!.linkGroups.length > 0) {
      setSelectedGroup(config!.linkGroups[0]);
    }
  }, [config?.linkGroups]);

  useEffect(() => {
    if (selectedGroup !== "" && config?.links) {
      setLocalLinks(
        (config.links as LinkItem[]).filter(
          (l) => (l.linkGroup ?? "") === selectedGroup
        )
      );
    } else {
      setLocalLinks([]);
    }
  }, [selectedGroup, config?.links]);

  const moveLinks = async (prevLocalIndex: number, newLocalIndex: number) => {
    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");
      if (!config?.links) throw new Error("No links in config");

      const links = config.links as LinkItem[];
      const movedLocal = localLinks[prevLocalIndex];
      if (!movedLocal) throw new Error("Invalid source index (localLinks)");

      // find source index in the full config.links array
      const srcGlobal = links.findIndex((l) => l.url === movedLocal.url);
      if (srcGlobal === -1) throw new Error("Source item not found in config.links");

      // indices of items in the same group (global)
      const group = selectedGroup ?? "";
      const groupIndices = links
        .map((l, i) => ((l.linkGroup ?? "") === group ? i : -1))
        .filter((i) => i !== -1);

      // clamp destination local index
      let dstLocal = newLocalIndex;
      if (dstLocal < 0) dstLocal = 0;
      if (dstLocal > groupIndices.length) dstLocal = groupIndices.length;

      // desired final index in the original array
      let finalIndexOriginal: number;
      if (groupIndices.length === 0) {
        finalIndexOriginal = links.length; // append to end
      } else if (dstLocal < groupIndices.length) {
        finalIndexOriginal = groupIndices[dstLocal];
      } else {
        finalIndexOriginal = groupIndices[groupIndices.length - 1] + 1; // after last in group
      }

      // server removes src first, so adjust dst if it comes after src
      const dstParam = finalIndexOriginal > srcGlobal ? finalIndexOriginal - 1 : finalIndexOriginal;

      // call server to move item
      const res = await fetch("/api/v1/config/move-arrayitems?path=links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ src: srcGlobal, dst: dstParam }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await refreshConfig(); // revert optimistic UI
        throw new Error(json.error || "Failed to move link on server");
      }

      // success — refresh authoritative config
      await refreshConfig();
    } catch (err) {
      console.error("moveLinks error:", err);
      try {
        await refreshConfig(); // ensure UI not stuck
      } catch (e) {
        console.warn("Failed to refresh config after move error", e);
      }
      throw err;
    }
  };

  const deleteLinks = async (urls: string[]) => {
    const token = localStorage.getItem("pb_token");
    if (!token) throw new Error("Not authenticated");

    // filter config.links and remove all urls that match
    const updatedItem = (config.links as LinkItem[]).filter(
      (l) => !urls.includes(l.url)
    );

    const res = await fetch("/api/v1/config?path=links", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ updatedItem }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || "Failed to delete link(s)");
    }

    // update local state immediately so UI feels snappy
    await refreshConfig();
    setLocalLinks((prev) => prev.filter((l) => !urls.includes(l.url)));
  };

  const toggleSelect = (url: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[url]) delete next[url];
      else next[url] = true;
      return next;
    });
  };

  const selectedUrls = Object.keys(selected);

  const handleDeleteSelected = () => {
    if (selectedUrls.length === 0) return;
    deleteLinks(selectedUrls);
    setSelected({});
    setSelectMode(false);
  };

  useEffect(() => {
    if (!selectMode) setSelected({});
  }, [selectMode]);

  // make selectMode and moveMode mutually exclusive
  useEffect(() => {
    if (selectMode && moveMode) setMoveMode(false);
  }, [selectMode]);

  useEffect(() => {
    if (moveMode && selectMode) setSelectMode(false);
  }, [moveMode]);

  const checkboxClass = "h-5 w-5 rounded-full";

  // drag handlers — supports showing insertion line between items (dropIndex)
  const handleDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    link: LinkItem
  ) => {
    if (!moveMode) {
      e.preventDefault();
      return;
    }
    setDraggingUrl(link.url);
    e.dataTransfer.setData("text/plain", link.url);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverItem = (
    e: React.DragEvent<HTMLLIElement>,
    index: number
  ) => {
    if (!moveMode) return;
    e.preventDefault(); // allow drop

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const insertBefore = offsetY < rect.height / 2;
    const newIndex = insertBefore ? index : index + 1;

    setDropIndex(newIndex);
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragOverList = (e: React.DragEvent<HTMLUListElement>) => {
    // called when dragging over the list itself (to allow dropping at the end)
    if (!moveMode) return;
    e.preventDefault();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    // rough heuristic: if below last item, set dropIndex to localLinks.length
    if (localLinks.length === 0) {
      setDropIndex(0);
      return;
    }

    // if y is below the last item's bottom, set to end
    const lastItem = e.currentTarget.querySelectorAll("li")[
      localLinks.length - 1
    ] as HTMLElement | undefined;

    if (lastItem) {
      const lastRect = lastItem.getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        setDropIndex(localLinks.length);
      }
    }
  };

  const handleDropOnList = (e: React.DragEvent<HTMLUListElement>) => {
    if (!moveMode) return;
    e.preventDefault();
    const fromUrl = e.dataTransfer.getData("text/plain") || draggingUrl || null;
    if (!fromUrl) return;

    const targetIndex = dropIndex ?? localLinks.length;
    const fromIndex = localLinks.findIndex((l) => l.url === fromUrl);
    if (fromIndex === -1) return;

    let toIndex = targetIndex;
    // if moving down the list and removing the source first, the insertion index shifts left by 1
    if (fromIndex < toIndex) toIndex -= 1;
    if (toIndex < 0) toIndex = 0;
    if (toIndex > localLinks.length - 1) toIndex = localLinks.length - 1 + (fromIndex === -1 ? 1 : 1);

    // perform frontend reorder
    const updated = [...localLinks];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setLocalLinks(updated);

    moveLinks(fromIndex, toIndex);

    // reset drag state
    setDraggingUrl(null);
    setDropIndex(null);
  };

  const handleDropOnItem = (
    e: React.DragEvent<HTMLLIElement>,
    index: number
  ) => {
    handleDropOnList(e as unknown as React.DragEvent<HTMLUListElement>);
  };

  const handleDragEnd = () => {
    setDraggingUrl(null);
    setDropIndex(null);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Links</h1>

      <div className="content space-y-2">
        <div className="row flex justify-between items-center">
          <Label htmlFor="link-group-select">Link Group</Label>

          {/* Select link group */}
          <Select
            onValueChange={(val) => {
              if (val === "+ Add new") {
                setIsCreateGroupOpen(true);
                return;
              }
              setSelectedGroup(val);
            }}
            value={selectedGroup ?? ""}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {linkGroups.map((group: any) => (
                <SelectItem key={group} value={group}>
                  {group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <CreateLinkGroupDialog
            open={isCreateGroupOpen}
            onOpenChange={setIsCreateGroupOpen}
            onCreated={(newGroup) => {
              setSelectedGroup(newGroup);
              setLocalLinks([]);
            }}
          />
        </div>

        {selectedGroup && localLinks.length > 0 ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between min-h-9 px-2">
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectMode}
                    onCheckedChange={(val) => setSelectMode(Boolean(val))}
                    className={checkboxClass}
                    id="toolbar-select-mode"
                  />
                  <span className="select-none">Select items {selectMode && `(${selectedUrls.length})`}</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={moveMode}
                    onCheckedChange={(val) => setMoveMode(Boolean(val))}
                    className={checkboxClass}
                    id="toolbar-move-mode"
                  />
                  <span className="select-none">Move items</span>
                </label>
              </div>

              <div>
                {selectMode ? (
                  <Button
                    onClick={handleDeleteSelected}
                    disabled={selectedUrls.length === 0}
                    variant="ghost"
                    className="rounded-full h-6"
                    title={
                      selectedUrls.length === 0
                        ? "Select items to delete"
                        : "Delete selected links"
                    }
                  >
                    <FontAwesomeIcon icon={faTrash} className="" />
                    Delete selected
                  </Button>
                ) : (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        className="rounded-full h-6"
                        title="Add new link"
                      >
                        <FontAwesomeIcon icon={faPlusCircle} />
                        Add new link
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="frosted text-white">
                      <DialogHeader>
                        <DialogTitle>Add new link</DialogTitle>
                      </DialogHeader>
                      <LinkDetailsForm link={{ "linkGroup": selectedGroup }} />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>

            {/* Links list */}
            <ul
              className="space-y-2 relative"
              onDragOver={handleDragOverList}
              onDrop={handleDropOnList}
            >
              {localLinks.map((link, idx) => {
                const isSelected = !!selected[link.url];
                const isDragging = draggingUrl === link.url;

                return (
                  <div key={link.id ?? link.url ?? idx} className="relative">
                    {/* insertion line before this item */}
                    {dropIndex === idx && (
                      <div className="h-[2px] bg-primary w-full my-1 rounded" />
                    )}

                    <li
                      className={`group relative flex items-center gap-3 h-10 px-2 rounded-md transition-colors hover-frosted cursor-pointer ${isDragging ? "opacity-60" : ""}`}
                      draggable={moveMode}
                      onDragStart={(e) => handleDragStart(e, link)}
                      onDragOver={(e) => handleDragOverItem(e, idx)}
                      onDrop={(e) => handleDropOnItem(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      {/* icon/checkbox container */}
                      <div className="w-6 h-6 flex items-center justify-center">
                        {/* Checkbox (fade in when selectMode true) */}
                        <Checkbox
                          id={`chk-${encodeURIComponent(link.url)}`}
                          checked={!!selected[link.url]}
                          onCheckedChange={() => toggleSelect(link.url)}
                          className={`${checkboxClass} transition-opacity duration-300 ${selectMode
                            ? "opacity-100"
                            : "opacity-0 pointer-events-none absolute"
                            }`}
                        />

                        {/* Icon (fade out when selectMode true) */}
                        {!selectMode && (
                          link.icon ? (
                            <img
                              src={link.icon}
                              alt={`${link.name} icon`}
                              className="w-8 h-8 rounded-full object-contain transition-opacity duration-300"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs transition-opacity duration-300">
                              {link.name?.slice(0, 1).toUpperCase()}
                            </div>
                          )
                        )}
                      </div>

                      {/* link content */}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 flex-1 no-underline"
                        onClick={(e) => {
                          // prevent navigation if in select or move mode
                          if (selectMode || moveMode) {
                            e.preventDefault();
                            if (selectMode) toggleSelect(link.url);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium hover:text-primary">{link.name}</span>
                          <span className="text-xs p-1 rounded-xl bg-(--primary) text-white text-muted-foreground truncate max-w-[560px]">
                            {link.url}
                          </span>
                        </div>
                      </a>

                      {/* Dropdown menu */}
                      {!selectMode && !moveMode && (
                        <div className="relative">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                aria-label="Open menu"
                                className="p-2 rounded hover:bg-muted"
                                onClick={(e) => e.stopPropagation()}
                              >
                                ⋮
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" side="bottom" className="w-36">
                              {/* EDIT action: open edit dialog populated with this link */}
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditingLink(link);
                                  setEditOpen(true);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onSelect={() => {
                                  deleteLinks([link.url]);
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => {
                                  // placeholder for future actions
                                }}
                              >
                                Open
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </li>
                  </div>
                );
              })}

              {/* insertion line at end */}
              {dropIndex === localLinks.length && (
                <div className="h-[2px] bg-primary w-full my-1 rounded" />
              )}
            </ul>
          </>
        ) : selectedGroup ? (
          <div className="flex items-start gap-2 mt-4">
            <p className="text-sm text-gray-200 w-full">No links in this group.</p>
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="rounded-full h-6"
                  title="Add new link"
                >
                  <FontAwesomeIcon icon={faPlusCircle} />
                  Add new link
                </Button>
              </DialogTrigger>
              <DialogContent className="frosted text-white">
                <DialogHeader>
                  <DialogTitle>Add new link</DialogTitle>
                </DialogHeader>
                <LinkDetailsForm link={{ linkGroup: selectedGroup }} />
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <p className="text-sm text-gray-200">Select a link group first</p>
        )}

        <h2 className="text-xl pt-2">Manage link groups</h2>

        <Dialog>
          <DialogTrigger asChild>
            <div className="flex border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md gap-2 cursor-pointer">
              <FontAwesomeIcon icon={faBars} />
              <p className="w-full">Rearrange</p>
              <FontAwesomeIcon icon={faCaretRight} />
            </div>
          </DialogTrigger>

          <DialogContent className="frosted">
            <DialogHeader>
              <DialogTitle>Rearrange link groups</DialogTitle>
            </DialogHeader>
            <MoveLinkGroupsFormComponent linkGroups={config?.linkGroups ?? []} />
          </DialogContent>
        </Dialog>

        {/* Delete unused groups dialog */}
        <Dialog>
          <DialogTrigger asChild>
            <div className="flex border border-transparent hover-frosted items-center col-span-full p-1.5 rounded-md gap-2">
              <FontAwesomeIcon icon={faBroom} />
              <p className="w-full">Delete unused ones</p>
              <FontAwesomeIcon icon={faCaretRight} />
            </div>
          </DialogTrigger>

          <DialogContent className="frosted text-(--text-primary)">
            <DialogHeader>
              <DialogTitle>Delete unused link groups</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-(--text-secondary)">
              This will remove all link groups that do not contain any links. This action cannot be undone.
            </DialogDescription>

            <DeleteUnusedLinkGroupsFormComponent
              onDeleted={async () => {
                await refreshConfig();
              }}
            />
          </DialogContent>

        </Dialog>

        {/* Edit Link dialog (single instance) */}
        <Dialog open={editOpen} onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditingLink(null);
        }}>
          <DialogContent className="frosted text-white">
            <DialogHeader>
              <DialogTitle>Edit link</DialogTitle>
            </DialogHeader>

            {/* Pass onClose so the form can close this dialog after save.
                LinkDetailsForm is expected to call refreshConfig() after saving,
                but we also call refreshConfig() here to ensure parent updates. */}
            <LinkDetailsForm
              link={editingLink ?? undefined}
              onClose={async () => {
                try {
                  setEditOpen(false);
                  setEditingLink(null);
                  await refreshConfig();
                  // try to update localLinks immediately
                  if (selectedGroup && (config?.links as LinkItem[])) {
                    setLocalLinks(
                      (config.links as LinkItem[]).filter(
                        (l) => (l.linkGroup ?? "") === selectedGroup
                      )
                    );
                  }
                } catch (err) {
                  console.warn("Error refreshing config after edit", err);
                }
              }}
            />
          </DialogContent>
        </Dialog>

      </div>
    </>
  );
}

function arraymove_helper<T>(arr: T[] = [], fromIndex: number, toIndex: number): T[] {
  const array = [...arr];

  // invalid fromIndex -> return original array
  if (fromIndex < 0 || fromIndex >= array.length) return array;

  // remove the element
  const [element] = array.splice(fromIndex, 1);

  // clamp toIndex to valid insertion range [0, array.length]
  if (toIndex < 0) toIndex = 0;
  if (toIndex > array.length) toIndex = array.length;

  // insert element at toIndex
  array.splice(toIndex, 0, element);

  return array;
}
