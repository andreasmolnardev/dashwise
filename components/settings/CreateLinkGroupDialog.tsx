"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useConfig } from "@/context/ConfigContext";
import useAuth from "@/context/useAuth";
import { appendConfigArrayItemAction } from "@/app/actions/config";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (newGroup: string) => void;
};

export default function CreateLinkGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const { config, refreshConfig } = useConfig();
  const { withAuth } = useAuth();

  const [alert, setAlert] = useState<{
    open: boolean;
    title: string;
    description?: string;
    variant?: "success" | "error";
  }>({ open: false, title: "", description: "", variant: "success" });

  const onCreateNewLinkGroupSubmit = async (newGroup: string) => {
    try {
      await withAuth((auth) =>
        appendConfigArrayItemAction(auth, "linkGroups", newGroup)
      );

      await refreshConfig();

      setAlert({
        open: true,
        title: "Link group created",
        description: `Created group "${newGroup}".`,
        variant: "success",
      });

      onCreated?.(newGroup);
    } catch (err: unknown) {
      let message = "Unknown error";

      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "string") {
        message = err;
      }

      setAlert({
        open: true,
        title: "Failed to create link group",
        description: message,
        variant: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-white">
        <DialogHeader>
          <DialogTitle>Create new link group</DialogTitle>
        </DialogHeader>

        {alert.open && (
          <Alert className="mb-4">
            <div className="flex justify-between items-start">
              <div>
                <AlertTitle>{alert.title}</AlertTitle>
                {alert.description && (
                  <AlertDescription>{alert.description}</AlertDescription>
                )}
              </div>
              <button
                aria-label="Close alert"
                onClick={() => setAlert({ ...alert, open: false })}
                className="ml-4 inline-flex items-center rounded px-2 py-1 text-sm hover:bg-muted"
              >
                Close
              </button>
            </div>
          </Alert>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const groupName = (formData.get("new-group-name") as string)?.trim();
            if (!groupName) return;
            await onCreateNewLinkGroupSubmit(groupName);
            onOpenChange(false);
          }}
          className="space-y-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-group-name">Group name</Label>
            <input
              id="new-group-name"
              name="new-group-name"
              type="text"
              className="rounded-md border p-2 text-black"
              placeholder="Enter group name"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
