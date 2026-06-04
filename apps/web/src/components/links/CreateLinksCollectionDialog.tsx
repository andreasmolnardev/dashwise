"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import useAuth from "@/context/useAuth";
import { createLinksCollectionAction, updateLinksCollectionAction } from '@/lib/apiClient';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection?: { id: string; name: string; description?: string; icon?: string; type?: string } | null;
  onSaved?: (collection: { id: string; name: string; description?: string; icon?: string; type?: string }) => void;
};

export default function CreateLinksCollectionDialog({ open, onOpenChange, collection, onSaved }: Props) {
  const { withAuth } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [alert, setAlert] = useState<{ open: boolean; title: string; description?: string; variant?: "success" | "error" }>({ open: false, title: "", description: "", variant: "success" });
  const isEditing = Boolean(collection?.id);

  useEffect(() => {
    if (!open) return;

    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
    setIcon(collection?.icon ?? "");
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
          <DialogTitle>{isEditing ? "Edit list" : "Create new list"}</DialogTitle>
        </DialogHeader>

        {alert.open && (
          <Alert className="mb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <AlertTitle>{alert.title}</AlertTitle>
                {alert.description && <AlertDescription>{alert.description}</AlertDescription>}
              </div>
              <button
                type="button"
                aria-label="Close alert"
                onClick={() => setAlert((current) => ({ ...current, open: false }))}
                className="rounded px-2 py-1 text-sm hover:bg-muted"
              >
                Close
              </button>
            </div>
          </Alert>
        )}

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();

            try {
              await handleSave();
              onOpenChange(false);
              setName("");
              setDescription("");
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
            <input
              id="list-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
              placeholder="Design inspiration"
              required
            />
          </div>

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

          <div className="space-y-2">
            <Label htmlFor="list-icon">Icon</Label>
            <input
              id="list-icon"
              name="icon"
              type="text"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
              placeholder="fa6-solid:folder-open or url:https://..."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEditing ? "Save changes" : "Create list"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}