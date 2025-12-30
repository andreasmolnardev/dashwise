"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import TopicCombobox, { type Topic } from "./TopicCombobox";
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
};

export default function CreateForwarderDialogComponent({
  open,
  onOpenChange,
  topics,
  onForwarderCreated,
}: CreateForwarderDialogProps) {
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [target, setTarget] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const handleTopicChange = (topic: Topic) => {
    setSelectedTopic(topic);
  };

  const handleCreate = async () => {
    if (!selectedTopic || !target) {
      alert("Please select a topic and enter a target");
      return;
    }
    setCreating(true);

    try {
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Missing auth token");

      const res = await fetch("/api/v1/notifications/forwarders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: selectedTopic.id,
          target,
          isActive,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create forwarder");

      // Reset
      setSelectedTopic(null);
      setTarget("");
      setIsActive(true);
      onOpenChange(false);

      onForwarderCreated?.(json.item);
    } catch (err) {
      console.error(err);
      alert("Failed to create forwarder");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-(--text-primary)">
        <DialogHeader>
          <DialogTitle>New Forwarder</DialogTitle>
        </DialogHeader>

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
              onChange={(e) => setTarget(e.target.value)}
            />
            <a className="text-xs text-gray-400 mt-1 hover:text-(--text-primary)" href="https://shoutrrr.nickfedor.com/">
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Forwarder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
