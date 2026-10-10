"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentSessionAction, renameCurrentSessionAction } from "@/lib/apiClient";
import { getClientSessionId } from "@/lib/session";

const defaultSessionName = "Web browser";

function dismissalStorageKey(userId: string, sessionId: string) {
  return `dashwise_session_name_prompt_dismissed:${userId}:${sessionId}`;
}

function wasPromptDismissed(storageKey: string | null) {
  if (!storageKey || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

export default function SessionNamePrompt() {
  const { token, user } = useAuth();
  const sessionId = getClientSessionId();
  const storageKey = user?.id && sessionId ? dismissalStorageKey(user.id, sessionId) : null;
  const queryClient = useQueryClient();
  const [dismissedKey, setDismissedKey] = useState(() => wasPromptDismissed(storageKey) ? storageKey : null);
  const [displayName, setDisplayName] = useState(defaultSessionName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDismissedKey(wasPromptDismissed(storageKey) ? storageKey : null);
  }, [storageKey]);

  const queryKey = ["current-session", token, sessionId] as const;
  const sessionQuery = useQuery({
    queryKey,
    enabled: Boolean(token && sessionId),
    retry: false,
    queryFn: () => {
      if (!token) throw new Error("You must be signed in to name this device.");
      return getCurrentSessionAction({ token });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => {
      if (!token) throw new Error("You must be signed in to name this device.");
      return renameCurrentSessionAction({ token }, name);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(queryKey, session);
    },
  });

  useEffect(() => {
    if (sessionQuery.data?.displayName) setDisplayName(sessionQuery.data.displayName);
  }, [sessionQuery.data?.displayName]);

  const persistDismissal = () => {
    setDismissedKey(storageKey);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      // Keep the prompt dismissed for this app session if browser storage is unavailable.
    }
  };

  const closePrompt = () => {
    if (renameMutation.isPending) return;
    setError(null);
    persistDismissal();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = displayName.trim();
    if (!nextName || nextName.length > 100) {
      setError("Enter a name between 1 and 100 characters.");
      return;
    }

    setError(null);
    if (nextName === sessionQuery.data?.displayName) {
      persistDismissal();
      return;
    }

    try {
      await renameMutation.mutateAsync(nextName);
      persistDismissal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this device.");
    }
  };

  const isDefaultName = sessionQuery.data?.displayName?.trim().toLowerCase() === defaultSessionName.toLowerCase();
  const isDismissed = dismissedKey === storageKey && storageKey !== null;
  const open = Boolean(token && sessionId && sessionQuery.data && isDefaultName && !isDismissed);
  const isPending = renameMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closePrompt()}>
      <DialogContent className="frosted text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Name this device</DialogTitle>
          <DialogDescription>
            Give this device a name to recognize it in your active sessions. You can keep the default name or dismiss this prompt.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="device-session-name">Device name</Label>
            <Input
              id="device-session-name"
              autoFocus
              autoComplete="off"
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={isPending}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closePrompt} disabled={isPending}>
              Keep default
            </Button>
            <Button type="submit" disabled={isPending || !displayName.trim()}>
              {isPending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
