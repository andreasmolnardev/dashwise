"use client";

import { useEffect, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import IconPickerComponent, { type IconResult } from "@/components/settings/IconPicker";
import useAuth from "@/context/useAuth";
import { createLinksCollectionAction, updateLinksCollectionAction } from '@/lib/apiClient';
import { LinksFormAlert, type LinksFormAlertState } from "./LinksFormAlert";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection?: { id: string; name: string; description?: string; icon?: string; type?: string } | null;
  renameOnly?: boolean;
  onSaved?: (collection: { id: string; name: string; description?: string; icon?: string; type?: string }) => void;
};

export default function CreateLinksCollectionDialog({ open, onOpenChange, collection, renameOnly = false, onSaved }: Props) {
  const { withAuth } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [alert, setAlert] = useState<LinksFormAlertState>({ open: false, title: "", description: "", variant: "success" });
  const isEditing = Boolean(collection?.id);

  useEffect(() => {
    if (!open) return;

    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
    setIcon(collection?.icon ?? "");
    setIconPickerOpen(false);
    setAlert({ open: false, title: "", description: "", variant: "success" });
  }, [collection, open]);

  const handleSave = async () => {
    if (!name.trim()) return;

    const saved = isEditing && collection?.id
      ? await withAuth((auth) => updateLinksCollectionAction(auth, collection.id, { name: name.trim(), description: description.trim() || undefined, icon: icon.trim() || undefined }))
      : await withAuth((auth) => createLinksCollectionAction(auth, { name: name.trim(), description: description.trim() || undefined, icon: icon.trim() || undefined }));

    setAlert({
      open: true,
      title: isEditing ? "List updated" : "List created",
      description: `${isEditing ? "Updated" : "Created"} list "${name.trim()}".`,
      variant: "success",
    });

    onSaved?.(saved as { id: string; name: string; description?: string; icon?: string; type?: string });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>{renameOnly ? "Rename list" : isEditing ? "Edit list" : "Create new list"}</DialogTitle>
        </DialogHeader>

        <LinksFormAlert alert={alert} onClose={() => setAlert((current) => ({ ...current, open: false }))} />

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();

            try {
              await handleSave();
              onOpenChange(false);
              setName("");
              setDescription("");
              setIcon("");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setAlert({
                open: true,
                title: `Failed to ${isEditing ? "update" : "create"} list`,
                description: message,
                variant: "error",
              });
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="list-name">List name</Label>
            <div className="flex items-center gap-2">
              <input
                id="list-name"
                name="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
                placeholder="Design inspiration"
                required
              />
              {!renameOnly && (
                <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="Search icons or Enter URL"
                      title="Search icons or Enter URL"
                      className="h-9 w-9 shrink-0 rounded-md border-white/10 bg-white/5 p-0 text-white hover:bg-white/10"
                    >
                      {icon ? <AppIcon source={icon} alt="" size={20} imageClassName="object-contain" /> : null}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="frosted w-[min(42rem,calc(100vw-2rem))] p-3 text-foreground">
                    <IconPickerComponent
                      initialSelection={icon ? { url: icon } : null}
                      onSelect={(selectedIcon: IconResult) => {
                        setIcon(selectedIcon.url?.trim() ?? "");
                        setIconPickerOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {!renameOnly && (
            <>
              <div className="space-y-2">
                <Label htmlFor="list-description">Description</Label>
                <textarea
                  id="list-description"
                  name="description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
                  placeholder="Optional note about what belongs here"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{renameOnly ? "Rename list" : isEditing ? "Save changes" : "Create list"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
