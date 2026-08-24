"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Button } from "../ui/button";
import { createTopicTokenAction, updateTopicTokenAction } from '@/lib/apiClient';
import TopicCombobox, { type Topic } from "./TopicCombobox";

export type TopicTokenItem = {
  id: string;
  token?: string;
  topic?: { id: string; title?: string } | string;
  expires?: string | null;
  created?: string | null;
};

type NewTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  onTokenCreated?: (newItem: any) => void;
  initialTopic?: Topic | null;
  initialToken?: TopicTokenItem | null;
  onBack?: () => void;
};

export default function nn({
  open,
  onOpenChange,
  topics,
  onTokenCreated,
  initialTopic = null,
  initialToken = null,
  onBack,
}: NewTokenDialogProps) {
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [creating, setCreating] = useState(false);
  const [expiryMode, setExpiryMode] = useState<"never" | "inDays" | "onDate">("never");
  const [inDays, setInDays] = useState<number>(30);
  const [onDate, setOnDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split("T")[0];
  });

  useEffect(() => {
    if (!open) return;

    setSelectedTopic(initialTopic);
    setExpiryMode(initialToken?.expires ? "onDate" : "never");
    setInDays(30);
    const d = initialToken?.expires ? new Date(initialToken.expires) : new Date();
    if (!initialToken?.expires) d.setMonth(d.getMonth() + 1);
    setOnDate(d.toISOString().split("T")[0]);
  }, [open, initialTopic, initialToken]);

  const expiryLabel = () => {
    if (expiryMode === "never") return "Never";
    if (expiryMode === "inDays") {
      const d = new Date();
      d.setDate(d.getDate() + (inDays || 0));
      return `In ${inDays} day${inDays === 1 ? "" : "s"} — ${format(d, "yyyy-MM-dd")}`;
    }
    if (expiryMode === "onDate") return onDate ? format(new Date(onDate), "yyyy-MM-dd") : "Select date";
    return "—";
  };

  const { withAuth } = useAuth();

  const handleCreate = async () => {
    if (!selectedTopic) return;
    setCreating(true);

    try {
      let expiresVal: string | undefined;
      if (expiryMode === "inDays") {
        const d = new Date();
        d.setDate(d.getDate() + (inDays || 0));
        expiresVal = d.toISOString();
      } else if (expiryMode === "onDate" && onDate) {
        expiresVal = new Date(onDate).toISOString();
      }

      const json = await withAuth((auth) => initialToken
        ? updateTopicTokenAction(auth, {
            tokenId: initialToken.id,
            topicId: selectedTopic.id,
            expires: expiresVal ?? null,
          })
        : createTopicTokenAction(auth, {
            topicId: selectedTopic.id,
            ...(expiresVal ? { expires: expiresVal } : {}),
          }));

      // Reset
      setSelectedTopic(null);
      setExpiryMode("never");
      setInDays(30);
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setOnDate(d.toISOString().split("T")[0]);
      onOpenChange(false);

      onTokenCreated?.(json.item);

    } catch (err) {
      console.error(err);
      alert(`Failed to ${initialToken ? "update" : "create"} token`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>{initialToken ? "Edit Topic Token" : "Create Topic Token"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Topic</label>
            <TopicCombobox
              topics={topics}
              value={selectedTopic}
              onChange={setSelectedTopic}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Expiry</label>
            <div className="flex gap-4 mb-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="expiry"
                  value="never"
                  checked={expiryMode === "never"}
                  onChange={() => setExpiryMode("never")}
                />
                <span>Never</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="expiry"
                  value="inDays"
                  checked={expiryMode === "inDays"}
                  onChange={() => setExpiryMode("inDays")}
                />
                <span>In x amount of days</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="expiry"
                  value="onDate"
                  checked={expiryMode === "onDate"}
                  onChange={() => setExpiryMode("onDate")}
                />
                <span>On a specific date</span>
              </label>
            </div>

            {expiryMode === "inDays" && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className="w-20 rounded px-2 py-1 bg-transparent border border-white/10"
                  value={inDays}
                  onChange={(e) => setInDays(Number(e.target.value || 0))}
                />
                <span>day{inDays === 1 ? "" : "s"}</span>
                <span className="text-xs text-muted-foreground">({expiryLabel()})</span>
              </div>
            )}

            {expiryMode === "onDate" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    {onDate ? format(new Date(onDate), "yyyy-MM-dd") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={onDate ? new Date(onDate) : undefined}
                    onSelect={(date) => date && setOnDate(date.toISOString().split("T")[0])}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => (onBack ? onBack() : onOpenChange(false))}
          >
            {onBack ? "Back" : "Cancel"}
          </Button>
          <Button disabled={!selectedTopic || creating} onClick={handleCreate}>
            {creating ? "Saving..." : initialToken ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
