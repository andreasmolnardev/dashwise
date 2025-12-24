"use client";

import React, { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { writeToConfig } from "@/lib/frontend/data/MUTATE/config/writeToConfig";
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
import { useConfig } from "@/context/ConfigContext";
import SearchEngineDetailsForm from "@/components/settings/SearchEngineDetailsForm";

export default function SearchSettingsPage() {
  const { config, refreshConfig } = useConfig();
  const [engines, setEngines] = useState<SearchEngine[]>(config?.searchEngines || []);

  // sync when config changes
  useEffect(() => {
    setEngines(config?.searchEngines || []);
  }, [config?.searchEngines]);

  async function persistEngines(updated: SearchEngine[]) {
    // update local state immediately for snappy UI
    setEngines(updated);

    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Not authenticated");
      await writeToConfig(`searchEngines`, updated, { token });
      // refresh authoritative config on success
      await refreshConfig();
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
              className="frosted rounded-2xl p-4 flex justify-between items-center"
            >
              <div className="flex items-center gap-4">
                <img src={engine.icon} alt="" className="w-6 h-6" />
                <div>
                  <h3 className="text-lg font-medium">{engine.name}</h3>
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

            <SearchEngineDetailsForm
              formId={createFormId}
              hideActions
              onSaved={async () => {
                // close dialog, refresh config and re-sync local engines (same pattern as Links page)
                setCreateOpen(false);
                try {
                  await refreshConfig();
                  setEngines(config?.searchEngines || []);
                } catch (err) {
                  console.warn("Error refreshing config after creating search engine", err);
                }
              }}
            />

            {/* footer with Cancel + Submit on same line */}
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>

              {/* this button submits the child form via form attribute */}
              <Button form={createFormId} type="submit">
                Add
              </Button>
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
                    await refreshConfig();
                    setEngines(config?.searchEngines || []);
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
      </div>
    </>
  );
}
