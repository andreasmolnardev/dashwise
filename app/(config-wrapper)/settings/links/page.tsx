"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faBroom, faCaretRight, faFolder, faEdit, faTrash, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";

import LinkDetailsForm from "@/components/settings/LinkDetailsForm";
import DeleteUnusedLinkGroupsFormComponent from "@/components/settings/DeleteUnusedLinkGroupsForm";
import MoveLinkGroupsFormComponent from "@/components/settings/MoveLinkGroupsForm";
import { Badge } from "@/components/ui/badge";
import { writeToConfig } from "@/lib/frontend/data/MUTATE/config/writeToConfig";
import {
  EditItemsForm,
  useEditItemsForm,
  ListHeader,
  Modes,
  Tabs,
  Tab,
  TabDropdown,
  CreateGroupAction,
  Actions,
  ListContent,
  ListItemPrototype,
  IndividualActions,
  Action,
  BulkActionsFooter,
  BulkItemsSelectedActions,
} from "@/components/EditItemsForm";
type LinkItem = {
  id?: string;
  name: string;
  url: string;
  icon?: string;
  linkGroup?: string;
  folder?: string;
};

export default function LinksSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [editOpen, setEditOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addingLinkGroup, setAddingLinkGroup] = useState<string>("");

  const [removeLinkFolderOpen, setRemoveLinkFolderOpen] = useState(false);
  const [linkToBeRemovedFromFolder, setLinkToBeRemovedFromFolder] = useState<string>("");

  const [selectedGroup, setSelectedGroup] = useState<string>("");

  useEffect(() => {
    if (!selectedGroup && Array.isArray(config?.linkGroups) && config!.linkGroups.length > 0) {
      setSelectedGroup(config!.linkGroups[0]);
    }
  }, [config?.linkGroups]);

  // read query params and open link group
  useEffect(() => {
    if (!searchParams) return;
    const linkGroupOpenParam = searchParams.get("group");

    if (linkGroupOpenParam) {
      setSelectedGroup(linkGroupOpenParam);
    }
  }, [searchParams, config?.linkGroups, config?.links]);

  // Helper: patch links array on server
  const pushLinks = async (updatedLinks: LinkItem[]) => {
    await writeToConfig("links", updatedLinks);
  };

  // Helper: patch groups on server
  const pushGroups = async (updatedGroups: string[]) => {
    await writeToConfig("linkGroups", updatedGroups);
  };

  // onCreateGroup: creates a group server-side and refreshes config
  const handleCreateGroup = async (name: string) => {
    try {
      const nextGroups = Array.from(new Set([...(config?.linkGroups ?? []), name]));
      await pushGroups(nextGroups);
      await refreshConfig();
      setSelectedGroup(name);
    } catch (err) {
      console.error("create group failed", err);
      window.alert("Failed to create group");
    }
  };

  // onGroupAction: rename or delete group
  const handleGroupAction = async (action: "rename" | "delete", groupName: string, payload?: any) => {
    try {
      if (!config?.links) throw new Error("No links");
      const links = (config.links as LinkItem[]).slice();
      const groups = (config.linkGroups ?? []).slice();

      if (action === "rename") {
        const newName = payload?.newName ?? window.prompt("Rename group", groupName);
        if (!newName || newName === groupName) return;
        // update groups list
        const nextGroups = groups.map((g) => (g === groupName ? newName : g));
        // update link items that referenced old group
        const nextLinks = links.map((l) => (l.linkGroup === groupName ? { ...l, linkGroup: newName } : l));
        await pushLinks(nextLinks);
        await pushGroups(nextGroups);
        await refreshConfig();
        setSelectedGroup(newName);
      } else if (action === "delete") {
        if (!confirm(`Delete group "${groupName}"? This will unassign it from links.`)) return;
        const nextGroups = groups.filter((g) => g !== groupName);
        const nextLinks = links.map((l) => (l.linkGroup === groupName ? { ...l, linkGroup: "" } : l));
        await pushLinks(nextLinks);
        await pushGroups(nextGroups);
        await refreshConfig();
        setSelectedGroup(nextGroups[0] ?? "");
      }
    } catch (err) {
      console.error("group action failed", err);
      window.alert("Failed to perform group action");
    }

  };

  // onUpdate handler for EditFormComponent — accepts staged items and optionally updated groups.
  // This will be invoked when the user clicks Save (requireConfirmation=true).
  const handleUpdateFromForm = async (updatedItems: LinkItem[], updatedGroups?: string[]) => {
    try {
      // persist links first
      await pushLinks(updatedItems);
      // persist groups if provided
      if (Array.isArray(updatedGroups)) {
        await pushGroups(updatedGroups);
      }
      await refreshConfig();
      // keep the selected group sensible after update (if groups changed)
      if (updatedGroups && updatedGroups.length > 0) {
        if (!updatedGroups.includes(selectedGroup) && updatedGroups[0]) {
          setSelectedGroup(updatedGroups[0]);
        }
      }
    } catch (err) {
      console.error("Failed to save changes from EditFormComponent", err);
      window.alert("Failed to save changes");
      throw err;
    }
  };

  // onEditItem: open existing LinkDetailsForm modal so user can edit the single item.
  // The LinkDetailsForm is responsible for saving to server and our refreshConfig() will pick it up.
  const handleOnEditItem = async (item: LinkItem) => {
    setEditingLink(item);
    setEditOpen(true);
  };

  // utility: build groups array for passing into EditFormComponent
  const groupsForForm = config?.linkGroups ?? [];

  // Optional small wrapper to convert config.links to LinkItem[] safely
  const linksForForm: LinkItem[] = Array.isArray(config?.links) ? (config!.links as LinkItem[]) : [];

  const checkboxClass = "h-5 w-5 rounded-full";

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Links</h1>

      <div className="content space-y-2">
        <EditItemsForm<LinkItem>
          items={linksForForm}
          groups={groupsForForm}
          groupBy="linkGroup"
          subgroupBy="folder"
          itemKey="id"
          enableSubgroup={true}
          onUpdate={async (updatedItems, updatedGroups) => {
            await handleUpdateFromForm(updatedItems, updatedGroups);
          }}
        >
          {/* Header with Mode Toggle, Group Tabs, and Actions */}
          <ListHeader>
            {/* Mode Toggle: Edit or Move */}
            <Modes
              editLabel="Edit"
              moveLabel="Move"
            />

            {/* Group Tabs */}
            <Tabs>
              {groupsForForm.map((group) => (
                <Tab
                  key={group}
                  name={group}
                  onRename={() => {
                    const newName = window.prompt("Rename group", group);
                    if (newName && newName !== group) {
                      handleGroupAction("rename", group, { newName });
                    }
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete group "${group}"?`)) {
                      handleGroupAction("delete", group);
                    }
                  }}
                />
              ))}
              <CreateGroupAction
                onCreateGroup={() => {
                  const name = window.prompt("New group name");
                  if (name && name.trim()) {
                    handleCreateGroup(name.trim());
                  }
                }}
              />
            </Tabs>

            {/* Additional Actions */}
            <Actions className="frosted rounded-md">
              <Action
                type="add"
                icon={faPlus}
                onClick={() => {
                  setAddingLinkGroup(selectedGroup);
                  setAddOpen(true);
                }}
              />
            </Actions>
          </ListHeader>

          {/* Main Items List - Use inner component for groupBy filtering */}
          <LinksListContent
            items={linksForForm}
            onEdit={handleOnEditItem}
            onUpdateItems={handleUpdateFromForm}
            setRemoveLinkFolderOpen={setRemoveLinkFolderOpen}
            setLinkToBeRemovedFromFolder={setLinkToBeRemovedFromFolder}
          />

          {/* Bulk Actions Footer */}
          <BulkActionsFooter>
            <SubgroupBulkActions
              items={linksForForm}
              onUpdateItems={handleUpdateFromForm}
            />
          </BulkActionsFooter>
        </EditItemsForm>

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

          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Delete unused link groups</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-muted-foreground">
              This will remove all link groups that do not contain any links. This action cannot be undone.
            </DialogDescription>

            <DeleteUnusedLinkGroupsFormComponent
              onDeleted={async () => {
                await refreshConfig();
              }}
            />
          </DialogContent>
        </Dialog>

        {/* Remove link subgroup*/}
        <Dialog open={removeLinkFolderOpen} onOpenChange={setRemoveLinkFolderOpen}>
          <DialogContent className="frosted text-foreground">
            <DialogHeader>
              <DialogTitle>Remove link from Folder</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-muted-foreground">
              This will remove the link from its folder but keep the link itself.
            </DialogDescription>
            <div className="flex gap-2 justify-end pt-4">
              <button
                onClick={() => setRemoveLinkFolderOpen(false)}
                className="px-4 py-2 rounded-md border border-(--border-color) hover:bg-(--surface-2) transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!linkToBeRemovedFromFolder) return;
                  try {
                    // Find the link and remove folder
                    const updatedLinks = linksForForm.map((link) =>
                      link.id === linkToBeRemovedFromFolder
                        ? { ...link, folder: undefined }
                        : link
                    );
                    // Call update
                    await handleUpdateFromForm(updatedLinks);
                    setRemoveLinkFolderOpen(false);
                    setLinkToBeRemovedFromFolder("");
                  } catch (err) {
                    console.error("Failed to remove link from folder", err);
                    window.alert("Failed to remove link from folder");
                  }
                }}
                className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white transition"
              >
                Remove
              </button>
            </div>
          </DialogContent>
        </Dialog>


        {/* Add Link dialog */}
        <Dialog open={addOpen} onOpenChange={(v) => {
          setAddOpen(v);
          if (!v) setAddingLinkGroup("");
        }}>
          <DialogContent className="frosted text-white">
            <DialogHeader>
              <DialogTitle>Add new link</DialogTitle>
            </DialogHeader>

            <LinkDetailsForm
              preselectOpenedGroup={addingLinkGroup}
              onClose={async () => {
                try {
                  setAddOpen(false);
                  await refreshConfig();
                  // try to update localLinks immediately
                  if (addingLinkGroup && (config?.links as LinkItem[])) {
                    const updatedLinks = (config.links as LinkItem[]).filter(
                      (l) => (l.linkGroup ?? "") === addingLinkGroup
                    );
                  }

                  if (addingLinkGroup) {
                    router.push(`/settings/links?group=${encodeURIComponent(addingLinkGroup)}`);
                  }
                } catch (err) {
                  console.warn("Error refreshing config after add", err);
                }
              }}
              link={{ linkGroup: addingLinkGroup }}
            />
          </DialogContent>
        </Dialog>

        {/* Edit Link dialog (single instance) — opened by onEditItem
    LinkDetailsForm is responsible for saving the single link to server and we refresh after it closes */}
        <Dialog open={editOpen} onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditingLink(null);
        }}>
          <DialogContent className="frosted text-white">
            <DialogHeader>
              <DialogTitle>Edit link</DialogTitle>
            </DialogHeader>

            <LinkDetailsForm
              preselectOpenedGroup={selectedGroup}
              link={editingLink ?? undefined}
              onClose={async () => {
                try {
                  setEditOpen(false);
                  setEditingLink(null);
                  await refreshConfig();
                  // navigate to same group if possible
                  if (selectedGroup) {
                    router.push(`/settings/links?group=${encodeURIComponent(selectedGroup)}`);
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

// Helper component to handle groupBy filtering with context hook
function LinksListContent({
  items,
  onEdit,
  onUpdateItems,
  setRemoveLinkFolderOpen,
  setLinkToBeRemovedFromFolder,
}: {
  items: LinkItem[];
  onEdit: (item: LinkItem) => void;
  onUpdateItems: (items: LinkItem[]) => Promise<void>;
  setRemoveLinkFolderOpen: (value: boolean) => void;
  setLinkToBeRemovedFromFolder: (value: string) => void;
}) {
  const { currentGroup, updateItems } = useEditItemsForm();

  // Filter items based on currently selected group
  const filteredItems = currentGroup
    ? items.filter((item) => item.linkGroup === currentGroup)
    : items;

  const handleRemoveFromFolder = (item: LinkItem) => {
    setLinkToBeRemovedFromFolder(item.id || "");
    setRemoveLinkFolderOpen(true);
  };

  return (
    <ListContent>
      {filteredItems.map((item, idx) => (
        <ListItemPrototype key={item.id || idx} item={item}>
          {/* Item Icon */}
          <div className="w-8 h-8 flex items-center justify-center rounded overflow-hidden flex-shrink-0">
            {item.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.icon} alt={`${item.name} icon`} className="object-contain w-full h-full" />
            ) : (
              <div className="w-8 h-8 bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-700">
                {item.name?.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          {/* Text Content - Name and URL */}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate text-foreground">{item.name}</div>
            <div className="text-xs text-muted-foreground truncate">{item.url}</div>
          </div>

          {/* Folder Badge if in subgroup */}
          {item.folder && (
            <Badge variant="secondary" className="flex items-center gap-1 flex-shrink-0 pr-1.5">
              <FontAwesomeIcon icon={faFolder} className="text-xs" />
              <span>{item.folder}</span>
              <button
                onClick={async () => {
                  try {
                    const updatedItems = items.map((link) =>
                      link.id === item.id
                        ? { ...link, folder: undefined }
                        : link
                    );
                    await onUpdateItems(updatedItems);
                  } catch (err) {
                    console.error("Failed to remove link from folder", err);
                    window.alert("Failed to remove link from folder");
                  }
                }}
                className="ml-1 hover:opacity-70 transition-opacity flex-shrink-0"
                title="Remove from folder"
              >
                <FontAwesomeIcon icon={faXmark} className="text-xs" />
              </button>
            </Badge>
          )}

          {/* Individual Item Actions */}
          <IndividualActions>
            <Action type="edit" icon={faEdit} onClick={() => onEdit(item)} label="Edit Link"/>
            {/* <Action
              type="move"
              icon={faArrowRight}
              onClick={() => {
                const targetGroup = window.prompt("Move to group:", item.linkGroup || "");
                if (targetGroup) {
                  const updated = { ...item, linkGroup: targetGroup };
                  const newItems = items.map((l) => (l.id === item.id ? updated : l));
                  // This needs to call the parent's update function
                  // For now, we'll trigger it through the context or parent callback
                }
              }}
            /> */}
            <Action
              type="delete"
              icon={faTrash}
              label="Delete Link"
              onClick={() => {
                if (window.confirm("Delete this link?")) {
                  // This would be handled by parent - needs to filter and update
                }
              }}
            />
          </IndividualActions>
        </ListItemPrototype>
      ))}
    </ListContent>
  );
}

/**
 * small helper - moves element in array (kept for compatibility with existing code)
 */
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

// Component to handle bulk subgroup creation with selected items
function SubgroupBulkActions({
  items,
  onUpdateItems,
}: {
  items: LinkItem[];
  onUpdateItems: (items: LinkItem[]) => Promise<void>;
}) {
  const { selected, itemKey } = useEditItemsForm();

  return (
    <BulkItemsSelectedActions
      onDelete={async () => {
        if (window.confirm("Delete all selected links?")) {
          try {
            // Filter out selected items, keeping only unselected ones
            const updatedItems = items.filter((item) => {
              const itemId = String(item[itemKey as keyof LinkItem] ?? "");
              return !selected[itemId];
            });
            await onUpdateItems(updatedItems);
          } catch (err) {
            console.error("Failed to delete selected links", err);
            window.alert("Failed to delete selected links");
          }
        }
      }}
      onMove={() => {
        const targetGroup = window.prompt("!WIP NOT WORKING! Move all selected links to:");
        if (targetGroup) {
          // Handle bulk move
        }
      }}
      onCreateSubgroup={async () => {
        const folderName = window.prompt("Create folder for selected items:");
        if (folderName && Object.values(selected).some(Boolean)) {
          try {
            // Update only selected items with new folder
            const updatedItems = items.map((item) => {
              const itemId = String(item[itemKey as keyof LinkItem] ?? "");
              if (selected[itemId]) {
                return { ...item, folder: folderName };
              }
              return item;
            });
            await onUpdateItems(updatedItems);
          } catch (err) {
            console.error("Failed to create subgroup", err);
            window.alert("Failed to create subgroup");
          }
        }
      }}
    />
  );
}
