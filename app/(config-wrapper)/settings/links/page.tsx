"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faBroom, faCaretRight, faFolder, faEdit, faArrowRight, faTrash, faPlus } from "@fortawesome/free-solid-svg-icons";

import LinkDetailsForm from "@/components/settings/LinkDetailsForm";
import DeleteUnusedLinkGroupsFormComponent from "@/components/settings/DeleteUnusedLinkGroupsForm";
import MoveLinkGroupsFormComponent from "@/components/settings/MoveLinkGroupsForm";
import TabSwitcher from "@/components/common/TabSwitcher";
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
            <Actions className="frosted">
              <Action
                type="clean"
                icon={faBroom}
                onClick={() => {
                  // Clean unused groups handled separately below
                }}
              />
              <Action
                type="add"
                icon={faPlus}
                onClick={() => setAddOpen(true)}
              />
            </Actions>
          </ListHeader>

          {/* Main Items List - Use inner component for groupBy filtering */}
          <LinksListContent 
            items={linksForForm} 
            onEdit={handleOnEditItem}
          />

          {/* Bulk Actions Footer */}
          <BulkActionsFooter>
            <BulkItemsSelectedActions
              onDelete={() => {
                if (window.confirm("Delete all selected links?")) {
                  // Get selected keys from context if needed
                  // For now, this is handled by the parent component
                }
              }}
              onMove={() => {
                const targetGroup = window.prompt("Move all selected links to:");
                if (targetGroup) {
                  // Handle bulk move
                }
              }}
              onCreateSubgroup={() => {
                const folderName = window.prompt("Create folder for selected items:");
                if (folderName) {
                  // Handle bulk create subgroup
                }
              }}
            />
          </BulkActionsFooter>
        </EditItemsForm>    <h2 className="text-xl pt-2">Manage link groups</h2>

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
}: {
  items: LinkItem[];
  onEdit: (item: LinkItem) => void;
}) {
  const { currentGroup } = useEditItemsForm();

  // Filter items based on currently selected group
  const filteredItems = currentGroup
    ? items.filter((item) => item.linkGroup === currentGroup)
    : items;

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
            <div className="font-medium truncate text-(--text-primary)">{item.name}</div>
            <div className="text-xs text-(--text-secondary) truncate">{item.url}</div>
          </div>

          {/* Folder Badge if in subgroup */}
          {item.folder && (
            <Badge variant="secondary" className="flex items-center gap-1 flex-shrink-0">
              <FontAwesomeIcon icon={faFolder} className="text-xs" />
              {item.folder}
            </Badge>
          )}

          {/* Individual Item Actions */}
          <IndividualActions>
            <Action type="edit" icon={faEdit} onClick={() => onEdit(item)} />
            <Action
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
            />
            <Action
              type="delete"
              icon={faTrash}
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
