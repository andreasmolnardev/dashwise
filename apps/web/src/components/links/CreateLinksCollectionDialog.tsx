"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import useAuth from "@/context/useAuth";
import { createLinksCollectionAction } from "@/app/actions/links";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (collection: { id: string; name: string; description?: string; type?: string }) => void;
};

export default function CreateLinksCollectionDialog({ open, onOpenChange, onCreated }: Props) {
  const { withAuth } = useAuth();
  const [alert, setAlert] = useState<{ open: boolean; title: string; description?: string; variant?: "success" | "error" }>({ open: false, title: "", description: "", variant: "success" });

  const handleCreate = async (name: string, description?: string) => {
    const created = await withAuth((auth) => createLinksCollectionAction(auth, { name, description }));

    setAlert({
      open: true,
      title: "List created",
      description: `Created list "${name}".`,
      variant: "success",
    });

    onCreated?.(created as { id: string; name: string; description?: string; type?: string });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>Create new list</DialogTitle>
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
            const description = String(formData.get("description") ?? "").trim();

            if (!name) return;

            try {
              await handleCreate(name, description || undefined);
              onOpenChange(false);
              event.currentTarget.reset();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setAlert({
                open: true,
                title: "Failed to create list",
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
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground outline-none transition-colors placeholder:text-white/35 focus:border-primary"
              placeholder="Optional note about what belongs here"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create list</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}