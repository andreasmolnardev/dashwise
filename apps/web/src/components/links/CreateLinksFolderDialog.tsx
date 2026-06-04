"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import useAuth from "@/context/useAuth";
import { createLinksFolderAction } from '@/lib/apiClient';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  parentFolderId?: string;
  onCreated?: (folder: { id: string; name: string; icon?: string; list: string; parentFolder?: string }) => void;
};

export default function CreateLinksFolderDialog({
  open,
  onOpenChange,
  listId,
  parentFolderId,
  onCreated,
}: Props) {
  const { withAuth } = useAuth();
  const [alert, setAlert] = useState<{ open: boolean; title: string; description?: string; variant?: "success" | "error" }>({
    open: false,
    title: "",
    description: "",
    variant: "success",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (name: string) => {
    const created = await withAuth((auth) =>
      createLinksFolderAction(auth, {
        list: listId,
        name,
        parentFolder: parentFolderId,
      }),
    );

    setAlert({
      open: true,
      title: "Folder created",
      description: `Created folder "${name}".`,
      variant: "success",
    });

    onCreated?.(created as { id: string; name: string; icon?: string; list: string; parentFolder?: string });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle>Create new folder</DialogTitle>
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
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("name") ?? "").trim();

            if (!name) return;

            try {
              setIsSubmitting(true);
              await handleCreate(name);
              onOpenChange(false);
              event.currentTarget.reset();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setAlert({
                open: true,
                title: "Failed to create folder",
                description: message,
                variant: "error",
              });
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <input
              id="folder-name"
              name="name"
              type="text"
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
              placeholder="New folder"
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create folder"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
