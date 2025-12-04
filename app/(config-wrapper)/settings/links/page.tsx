"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfig } from "@/context/ConfigContext";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faBroom, faCaretRight, faFolder } from "@fortawesome/free-solid-svg-icons";

import LinkDetailsForm from "@/components/settings/LinkDetailsForm";
import DeleteUnusedLinkGroupsFormComponent from "@/components/settings/DeleteUnusedLinkGroupsForm";
import MoveLinkGroupsFormComponent from "@/components/settings/MoveLinkGroupsForm";
import EditFormComponent from "@/components/settings/EditForm";
import { writeToConfig } from "@/lib/frontend/data/write";
type LinkItem = {
  id?: string;
  name: string;
  url: string;
  icon?: string;
  linkGroup?: string;
  // optional subgroup e.g. folder
  folder?: string;
};

export default function LinksSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Link edit dialog state (used by onEditItem)
  const [editOpen, setEditOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null);

  // Link add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addingLinkGroup, setAddingLinkGroup] = useState<string>("");

  // Track selected group from query params
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
  const patchLinksOnServer = async (updatedLinks: LinkItem[]) => {
    await writeToConfig("links", updatedLinks);
  };

  // Helper: patch groups on server
  const patchGroupsOnServer = async (updatedGroups: string[]) => {
    await writeToConfig("linkGroups", updatedGroups);
  };

  // onCreateGroup: creates a group server-side and refreshes config
  const handleCreateGroup = async (name: string) => {
    // optimistic local update handled inside EditFormComponent when requireConfirmation=false,
    // but here we are expected to create server-side right away because parent flow expects it.
    try {
      const nextGroups = Array.from(new Set([...(config?.linkGroups ?? []), name]));
      await patchGroupsOnServer(nextGroups);
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
        await patchLinksOnServer(nextLinks);
        await patchGroupsOnServer(nextGroups);
        await refreshConfig();
        setSelectedGroup(newName);
      } else if (action === "delete") {
        if (!confirm(`Delete group "${groupName}"? This will unassign it from links.`)) return;
        const nextGroups = groups.filter((g) => g !== groupName);
        const nextLinks = links.map((l) => (l.linkGroup === groupName ? { ...l, linkGroup: "" } : l));
        await patchLinksOnServer(nextLinks);
        await patchGroupsOnServer(nextGroups);
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
      await patchLinksOnServer(updatedItems);
      // persist groups if provided
      if (Array.isArray(updatedGroups)) {
        await patchGroupsOnServer(updatedGroups);
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
        {/* EditFormComponent for managing links */}
        <EditFormComponent<LinkItem>
          title="Manage Links"
          items={linksForForm}
          groups={groupsForForm}
          groupBy={"linkGroup"}
          itemKey={"id"}
          createNewGroup={true}
          requireConfirmation={true}
          switchBetweenModes={true}
          defaultMode={"edit"}
          singleActions={["edit", "delete", "moveOrder", "move"]}
          bulkActions={["delete", "move"]}
          moveItems={"onMoveMode"}
          enableSubgroup={true} // if you want folders/subgroups enabled (reading `folder` prop)
          subgroupBy={"folder"}
          iconRounded={false}
          onCreateGroup={async (name: string) => {
            await handleCreateGroup(name);
          }}
          onGroupAction={async (action, groupName, payload) => {
            // payload may contain newName for rename
            await handleGroupAction(action as "rename" | "delete", groupName, payload);
          }}
          onUpdate={async (updatedItems, updatedGroups) => {
            await handleUpdateFromForm(updatedItems, updatedGroups);
          }}
          onEditItem={async (item) => {
            // open modal to let LinkDetailsForm handle editing
            await handleOnEditItem(item);
          }}
          renderAddItem={(groupName: string, onAdded: (item: LinkItem) => void, onCancel: () => void) => {
            // Avoid calling setState during render (causes React error).
            // Instead return a component that opens the dialog in useEffect after mount.
            const DialogOpener: React.FC = () => {
              useEffect(() => {
                setAddingLinkGroup(groupName);
                setAddOpen(true);
                // Close the inline add state in EditForm (onCancel) so this opener doesn't get remounted
                // and reopen the dialog immediately when the user closes it.
                try {
                  onCancel();
                } catch (e) {
                  // ignore
                }
                // eslint-disable-next-line react-hooks/exhaustive-deps
              }, []);
              return null;
            };

            return <DialogOpener />;
          }}
          initialGroup={selectedGroup}
          renderRow={(item: LinkItem, isSelected, mode) => (
            <div className="flex items-center gap-3">
              {/* small icon */}
              <div className="w-8 h-8 flex items-center justify-center rounded overflow-hidden">
                {item.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.icon} alt={`${item.name} icon`} className="object-contain w-full h-full" />
                ) : (
                  <div className="w-8 h-8 bg-gray-200 flex items-center justify-center text-xs">
                    {item.name?.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.name}</div>
                <div className="text-xs text-white/60 truncate">{item.url}</div>
              </div>
            </div>
          )}
        />    <h2 className="text-xl pt-2">Manage link groups</h2>

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
