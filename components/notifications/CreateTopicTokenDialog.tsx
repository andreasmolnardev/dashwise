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
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Button } from "../ui/button";
import { TokenItem } from "@/app/(config-wrapper)/notifications/tokens/page";

export type Topic = { id: string; title: string };

type NewTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  onTokenCreated?: (newItem: TokenItem) => void;
};

export default function CreateTopicTokenDialogComponent({
  open,
  onOpenChange,
  topics,
  onTokenCreated,
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

      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Missing auth token");

      const res = await fetch("/api/v1/notifications/topicTokens", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topicId: selectedTopic.id, ...(expiresVal ? { expires: expiresVal } : {}) }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create token");

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
      alert("Failed to create token");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-(--text-primary)">
        <DialogHeader>
          <DialogTitle>New Token</DialogTitle>
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
                <span className="text-xs text-(--text-secondary)">({expiryLabel()})</span>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!selectedTopic || creating} onClick={handleCreate}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TopicComboboxProps = {
  topics: Topic[];
  value: Topic | null;
  onChange: (topic: Topic) => void;
};

export function TopicCombobox({ topics, value, onChange }: TopicComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [localTopics, setLocalTopics] = useState<Topic[]>(topics);

  useEffect(() => setLocalTopics(topics), [topics]);

  const filtered = inputValue
    ? localTopics.filter((t) => t.title.toLowerCase().includes(inputValue.toLowerCase()))
    : localTopics;

  const handleSelect = async (title: string) => {
    const existing = localTopics.find((t) => t.title === title);
    if (existing) {
      onChange(existing);
      setOpen(false);
      return;
    }

    try {
      setCreating(true);
      const token = localStorage.getItem("pb_token");
      if (!token) throw new Error("Missing auth token");

      const res = await fetch("/api/v1/notifications/topics", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create topic");

      const newTopic: Topic = { id: json.topicId, title };
      setLocalTopics((old) => [...old, newTopic]);
      onChange(newTopic);
      setOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to create topic");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value?.title || "Select or create topic..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command  className="text-black">
          <CommandInput
            placeholder="Search or type new topic..."
            value={inputValue}
            onValueChange={setInputValue}
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>
              {inputValue ? `Create "${inputValue}"` : "No topics found."}
            </CommandEmpty>
            <CommandGroup className="text-black">
              {filtered.map((topic) => (
                <CommandItem
                  key={topic.id}
                  value={topic.title}
                  onSelect={() => handleSelect(topic.title)}
                >
                  {topic.title}
                  <Check
                    className={cn(
                      "ml-auto",
                      value?.id === topic.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
              {inputValue && !localTopics.some((t) => t.title === inputValue) && (
                <CommandItem
                  value={inputValue}
                  onSelect={() => handleSelect(inputValue)}
                >
                  Create "{inputValue}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
