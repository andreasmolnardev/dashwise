"use client";

import { useState, useEffect } from "react";
import useAuth from "@/context/useAuth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import TopicCombobox, { type Topic } from "./TopicCombobox";
import { createForwarderAction, testForwarderTargetAction } from '@/lib/apiClient';
export type ForwarderItem = { 
  id: string; 
  topic: { id: string }; 
  target: string; 
  isActive: boolean;
  created?: string | null;
  updated?: string | null;
};

type CreateForwarderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  onForwarderCreated?: (newItem: ForwarderItem) => void;
  initialTopic?: Topic | null;
  onBack?: () => void;
};

export default function CreateForwarderDialogComponent({
  open,
  onOpenChange,
  topics,
  onForwarderCreated,
  initialTopic = null,
  onBack,
}: CreateForwarderDialogProps) {
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [target, setTarget] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { withAuth } = useAuth();

  useEffect(() => {
    if (!open) return;

    setSelectedTopic(initialTopic);
    setTarget("");
    setIsActive(true);
    setError(null);
  }, [open, initialTopic]);

  const handleTopicChange = (topic: Topic) => {
    setSelectedTopic(topic);
  };

  const handleCreate = async () => {
    if (!selectedTopic || !target) {
      alert("Please select a topic and enter a target");
      return;
    }
    setCreating(true);
    setError(null);

    try {
      await withAuth((auth) => testForwarderTargetAction(auth, target));

      const json = await withAuth((auth) =>
        createForwarderAction(auth, { topic: selectedTopic.id, target, isActive })
      );

      // Reset
      setSelectedTopic(null);
      setTarget("");
      setIsActive(true);
      onOpenChange(false);

      onForwarderCreated?.({
        id: json?.item?.id,
        topic: { id: selectedTopic.id },
        target,
        isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create forwarder or send test notification");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground">
        <DialogHeader>
          <DialogTitle>New Forwarder</DialogTitle>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Forwarder test failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Topic</label>
            <TopicCombobox
              topics={topics}
              value={selectedTopic}
              onChange={handleTopicChange}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Shoutrrr Target</label>
            <Input
              placeholder="e.g., discord://webhook-url or slack://token/channel"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setError(null);
              }}
            />
            <a className="text-xs text-gray-400 mt-1 hover:text-foreground" href="https://shoutrrr.nickfedor.com/">
              For more info, visit Shoutrrr's docs
            </a>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isActive"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked as boolean)}
            />
            <label htmlFor="isActive" className="text-sm font-medium">
              Active
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (onBack ? onBack() : onOpenChange(false))}
          >
            {onBack ? "Back" : "Cancel"}
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Testing..." : "Test & Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
