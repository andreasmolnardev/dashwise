"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import useAuth from "@/context/useAuth";
import { createLinksTagAction, updateLinksTagAction } from '@/lib/apiClient';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag?: { id: string; name: string; color?: string } | null;
  onSaved?: (tag: { id: string; name: string; color?: string }) => void;
};

export default function CreateLinksTagDialog({ open, onOpenChange, tag, onSaved }: Props) {
  const { withAuth } = useAuth();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  const [alert, setAlert] = useState<{ open: boolean; title: string; description?: string; variant?: "success" | "error" }>({ open: false, title: "", description: "", variant: "success" });
  const isEditing = Boolean(tag?.id);

  useEffect(() => {
    if (!open) return;

    setName(tag?.name ?? "");
    setColor(tag?.color || "#0ea5e9");
    setAlert({ open: false, title: "", description: "", variant: "success" });
  }, [open, tag]);

  const handleSave = async () => {
    if (!name.trim()) return;

    const saved = isEditing && tag?.id
      ? await withAuth((auth) => updateLinksTagAction(auth, tag.id, { name: name.trim(), color: color.trim() || undefined }))
      : await withAuth((auth) => createLinksTagAction(auth, { name: name.trim(), color: color.trim() || undefined }));

    setAlert({
      open: true,
      title: isEditing ? "Tag updated" : "Tag created",
      description: `${isEditing ? "Updated" : "Created"} tag "${name.trim()}".`,
      variant: "success",
    });

    onSaved?.(saved as { id: string; name: string; color?: string });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit tag" : "Create new tag"}</DialogTitle>
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
              setColor("#0ea5e9");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setAlert({
                open: true,
                title: `Failed to ${isEditing ? "update" : "create"} tag`,
                description: message,
                variant: "error",
              });
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="tag-name">Tag name</Label>
            <input
              id="tag-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
              placeholder="Urgent"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tag-color">Color</Label>
            <input
              id="tag-color"
              name="color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-full cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-1"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEditing ? "Save changes" : "Create tag"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}