"use client";

import React, { useState } from "react";
import { usePageConfig } from "@/hooks/usePageConfig";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import { deleteUnusedLinkgroupsAction } from "@/app/actions/config";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { DialogClose } from "@/components/ui/dialog";

type Props = {
  onDeleted?: () => void | Promise<void>;
};

export default function DeleteUnusedLinkGroupsFormComponent({ onDeleted }: Props) {
  const { refreshConfig } = usePageConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { token, withAuth } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (!token) throw new Error("Not authenticated");

      try {
        await withAuth((auth) => deleteUnusedLinkgroupsAction(auth));
        setSuccess("Unused link groups deleted.");
        await refreshConfig();
      } catch (err: any) {
        throw err;
      }

      if (onDeleted) await onDeleted();
    } catch (err: any) {
      setError(err?.message || "Failed to delete unused link groups");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      {error && (
        <Alert className="mb-2" variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-2">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 justify-end">
        <DialogClose asChild>
          <Button variant="outline" type="button" disabled={loading}>
            Cancel
          </Button>
        </DialogClose>

        <Button type="submit" disabled={loading}>
          {loading ? "Deleting..." : "Delete unused"}
        </Button>
      </div>
    </form>
  );
}
