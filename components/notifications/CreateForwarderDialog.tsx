"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";

export type Topic = { id: string; title: string };
export type ForwarderItem = { id: string; topic: { id: string }; target: string; isActive: boolean };

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
              onChange={setSelectedTopic}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Shoutrrr Target</label>
            <Input
              placeholder="e.g., discord://webhook-url or slack://token/channel"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              Enter a Shoutrrr service expression for forwarding notifications
            </p>
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

function TopicCombobox({
  topics,
  value,
  onChange,
}: {
  topics: Topic[];
  value: Topic | null;
  onChange: (topic: Topic | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value ? value.title : "Select topic..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search topics..." />
          <CommandEmpty>No topics found.</CommandEmpty>
          <CommandGroup>
            <CommandList>
              {topics.map((topic) => (
                <CommandItem
                  key={topic.id}
                  value={topic.id}
                  onSelect={() => {
                    onChange(value?.id === topic.id ? null : topic);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.id === topic.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {topic.title}
                </CommandItem>
              ))}
            </CommandList>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
