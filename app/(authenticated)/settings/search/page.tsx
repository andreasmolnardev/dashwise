"use client";

import React, { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { updateConfigPathAction } from "@/app/actions/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Plus, MoreHorizontal } from "lucide-react";
import { usePageConfig } from "@/hooks/usePageConfig";
import SearchEngineDetailsForm from "@/components/settings/SearchEngineDetailsForm";
import TabSwitcher from "@/components/common/TabSwitcher";
import SearchEngineBrowseFeedComponent from "@/components/settings/SearchEngineBrowseFeed";
import { Icon } from "@iconify-icon/react";
import { Select, SelectValue, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import useAuth from "@/context/useAuth";

export default function SearchSettingsPage() {
  const { withAuth, user, updateUserProperty } = useAuth();
  const [engines, setEngines] = useState<SearchEngine[]>(user.searchPreferences?.searchEngines || []);
  const [activeTab, setActiveTab] = useState("manual");

  // sync when config changes
  useEffect(() => {
    setEngines(user.searchPreferences?.searchEngines || []);
  }, [user.searchPreferences?.searchEngines]);

  const handleOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      // Small delay to reset tab so it looks fresh next time
      setTimeout(() => setActiveTab("manual"), 200);
    }
  };

  async function persistEngines(updated: SearchEngine[]) {
    // update local state immediately for snappy UI
    setEngines(updated);

    try {
      updateUserProperty("searchPreferences", {
        ...user.searchPreferences,
        searchEngines: updated,
      });
    } catch (err) {
      console.error("Failed to persist search engines:", err);
      // NOTE: we don't revert local state here — you can add error recovery if desired
    }
  }

  function toggleEngine(slug: string) {
    const updated = engines.map((e) => {
      if (e.slug !== slug) return e;
      if (e.status === "default") return e;
      return {
        ...e,
        status: e.status === "disabled" ? "enabled" as "enabled" : "disabled" as "disabled"
      };
    });
    persistEngines(updated);
  }

  function setDefault(slug: string) {
    const updated = engines.map((e) => ({
      ...e,
      status: e.slug === slug
        ? "default" as "default"
        : e.status === "default"
          ? "enabled" as "enabled"
          : e.status,
    }));
    persistEngines(updated);
  }

  function removeDefault(slug: string) {
    const updated = engines.map((e) =>
      e.slug === slug && e.status === "default"
        ? { ...e, status: "enabled" as "enabled" }
        : e
    );
    persistEngines(updated);
  }

  function deleteEngine(slug: string) {
    const updated = engines.filter((e) => e.slug !== slug);
    persistEngines(updated);
  }

  // create/edit dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingEngine, setEditingEngine] = useState<SearchEngine | null>(null);

  const createFormId = "se-create-form";
  const editFormId = "se-edit-form";

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Search</h1>
      <div className="content space-y-4 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold mb-2">Search engines</h2>
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {engines.map((engine) => (
            <div
              key={engine.slug}
              className="frosted rounded-2xl p-4 flex justify-between items-center group"
            >
              <div className="flex items-center gap-4">
                <img src={engine.icon} alt="" className="w-6 h-6" />
                <div>
                  <h3 className="text-lg font-medium group-hover:text-(--primary)">{engine.name}</h3>
                  <p className="text-sm text-gray-100">
                    {engine.url_home} - !{engine.slug} {engine.status === "default" && " - Default engine"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Switch
                  checked={engine.status !== "disabled"}
                  onCheckedChange={() => toggleEngine(engine.slug)}
                  className="[&>span]:bg-white [&>span[data-state=checked]]:bg-white"
                />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {engine.status === "default" ? (
                      <DropdownMenuItem onClick={() => removeDefault(engine.slug)}>
                        Remove default
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setDefault(engine.slug)}>
                        Set as default
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem
                      onClick={() => {
                        setEditingEngine(engine);
                        setEditOpen(true);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-500" onClick={() => deleteEngine(engine.slug)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>

        {/* Create dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="frosted text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add search engine</DialogTitle>
            </DialogHeader>

            <TabSwitcher
              value={activeTab}
              onValueChange={setActiveTab}
              className="mt-1"
              items={[
                { value: "manual", label: "Manual" },
                { value: "browse", label: "Browse" },
              ]}
            />

            <div className="flex-1 min-h-0 relative">
              {/* MANUAL MODE */}
              {activeTab === "manual" && (
                <SearchEngineDetailsForm
                  formId="create-engine-form"
                  hideActions
                  onSaved={async () => {
                    setCreateOpen(false);
                    // Trigger your refresh/sync logic here
                  }}
                />
              )}

              {/* BROWSE MODE */}
              {activeTab === "browse" && (
                // Scroll area wrapper is critical for infinite scroll to work inside a modal
                <div className="h-[50vh] overflow-y-auto">
                  <SearchEngineBrowseFeedComponent />
                </div>
              )}
            </div>

            {/* 4. Dynamic Footer */}
            <DialogFooter className="flex justify-end gap-2 mt-4">
              <DialogClose asChild>
                <Button variant="outline">
                  {activeTab === "browse" ? "Done" : "Cancel"}
                </Button>
              </DialogClose>

              {/* Only show 'Add' button if in Manual mode (Browse mode has individual add buttons) */}
              {activeTab === "manual" && (
                <Button form="create-engine-form" type="submit">
                  Add
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit dialog */}
        <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingEngine(null); }}>
          <DialogContent className="frosted text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit search engine</DialogTitle>
            </DialogHeader>

            {editingEngine && (
              <SearchEngineDetailsForm
                engine={editingEngine}
                formId={editFormId}
                hideActions
                onSaved={async () => {
                  // close edit dialog, clear editing engine, refresh and re-sync local engines
                  setEditOpen(false);
                  setEditingEngine(null);
                  try {
                    setEngines(user.searchPreferences?.searchEngines || []);
                  } catch (err) {
                    console.warn("Error refreshing config after editing search engine", err);
                  }
                }}
              />
            )}

            {/* footer with Cancel + Save on one line; disable Save until we have an editingEngine */}
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button form={editFormId} type="submit" disabled={!editingEngine}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
          <h2 className="text-xl font-semibold mb-0">Shortcuts</h2>
        <RedirectBangsSetting user={user} />
      </div>
    </>
  );
}

function RedirectBangsSetting(user) {
  const { config, refreshConfig } = usePageConfig();
  const { withAuth } = useAuth();

  async function handleChange(newVal: string) {
    await withAuth((auth) => updateConfigPathAction(auth, "global", {
      ...config.global,
      searchEngineShortcutFallback: newVal,
    }, "home"));

    await refreshConfig();
  }
  // write to user search

  return (
    <div className="flex border border-transparent items-center col-span-full p-1.5 rounded-md gap-2">
      <Icon icon="fa6-solid:arrow-right" />
      <p className="w-full">Redirect Unknown Shortcuts To</p>

      <Select
        value={user.searchPreferences?.searchEngineShortcutFallback}
        onValueChange={handleChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Engine" />
        </SelectTrigger>

        <SelectContent>
          {user.searchPreferences?.searchEngines.map((engine) => (
            <SelectItem key={engine.slug} value={engine.slug}>
              {engine.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
