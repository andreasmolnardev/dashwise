"use client";

import { useEffect, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import useAuth from "@/context/useAuth";
import { getShortcutsAction } from "@/lib/apiClient";
import { Input } from "@/components/ui/input";

type Shortcut = {
  id: string;
  name: string;
  icon?: string;
  secondaryInfo?: string;
  type?: string;
};

export default function ShortcutsPicker(
  { value, onChange }: { value: string[]; onChange: (value: string[]) => void },
) {
  const { withAuth } = useAuth();
  const [items, setItems] = useState<Shortcut[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void withAuth((auth) => getShortcutsAction(auth)).then((data) => {
      if (Array.isArray(data)) setItems(data as Shortcut[]);
    }).catch(() => setItems([]));
  }, [withAuth]);
  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase())
  );
  const toggle = (id: string) =>
    onChange(
      value.includes(id)
        ? value.filter((selected) => selected !== id)
        : [...value, id],
    );
  return (
    <div className="space-y-3 py-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shortcuts..."
      />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {filtered.map((item) => {
          const selected = value.includes(item.id);
          return (
            <label
              key={item.id}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-white/10 ${
                selected ? "bg-white/15" : ""
              }`}
            >
              <AppIcon source={item.icon ?? ""} alt="" size={20} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.name}</span>
                {(item.secondaryInfo || item.type)
                  ? (
                    <span className="block truncate text-xs text-white/50">
                      {[item.secondaryInfo, item.type].filter(Boolean).join(
                        " · ",
                      )}
                    </span>
                  )
                  : null}
              </span>

              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggle(item.id)}
                className="size-4 shrink-0 accent-primary"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
