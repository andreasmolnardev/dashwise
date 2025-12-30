"use client";

import { useState, useEffect } from "react";
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

export type Topic = { id: string; title: string };

type TopicComboboxProps = {
  topics: Topic[];
  value: Topic | null;
  onChange: (topic: Topic) => void;
};

export default function TopicCombobox({ topics, value, onChange }: TopicComboboxProps) {
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
        <Command className="text-black">
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
