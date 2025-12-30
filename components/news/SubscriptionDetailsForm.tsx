"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@radix-ui/react-label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface NewsFeed {
  id?: string;
  feedUrl: string;
  name?: string;
  icon?: string;
  category?: string;
}

interface SubscriptionDetailsFormProps {
  feed?: NewsFeed;
  categories: string[];
  onClose?: () => void | Promise<void>;
  onSave?: (feed: NewsFeed) => Promise<void> | void;
}

export default function SubscriptionDetailsForm({
  feed,
  categories,
  onClose,
  onSave,
}: SubscriptionDetailsFormProps) {
  const [feedUrl, setFeedUrl] = useState(() => feed?.feedUrl || "");
  const [name, setName] = useState(() => feed?.name || "");
  const [icon, setIcon] = useState(() => feed?.icon || "");
  const [category, setCategory] = useState(() => feed?.category || categories[0] || "Uncategorized");
  const [customCategory, setCustomCategory] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(feed?.feedUrl && feed?.name);

  // Auto-generate icon from feed URL's favicon
  useEffect(() => {
    if (!icon && feedUrl && !isEditing) {
      try {
        const origin = new URL(feedUrl).origin;
        setIcon(`${origin}/favicon.ico`);
      } catch {
        /* ignore invalid URLs */
      }
    }
  }, [feedUrl, icon, isEditing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!feedUrl.trim()) {
        throw new Error("Feed URL is required");
      }

      const finalCategory = useCustom
        ? customCategory.trim() || "Uncategorized"
        : category || "Uncategorized";

      const payload: NewsFeed = {
        feedUrl: feedUrl.trim(),
        name: name.trim() || feedUrl.trim(),
        icon: icon.trim(),
        category: finalCategory,
      };

      if (feed?.id) {
        payload.id = feed.id;
      }

      if (onSave) {
        await onSave(payload);
      }

      if (onClose) await onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="feed-url">Feed URL *</Label>
        <Input
          id="feed-url"
          className="frosted mt-1"
          placeholder="https://example.com/feed.xml"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          disabled={loading || isEditing}
        />
      </div>

      <div>
        <Label htmlFor="feed-name">Feed Name</Label>
        <Input
          id="feed-name"
          className="frosted mt-1"
          placeholder="My Feed"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />
      </div>

      <div>
        <Label htmlFor="feed-icon">Icon URL</Label>
        <Input
          id="feed-icon"
          className="frosted mt-1"
          placeholder="https://example.com/icon.png"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          disabled={loading}
        />
        <p className="text-xs text-white/60 mt-1">
          Defaults to feed domain favicon if left empty
        </p>
      </div>

      <div>
        <Label htmlFor="feed-category">Category</Label>
        <Select
          value={useCustom ? "__custom__" : category}
          onValueChange={(v) => {
            if (v === "__custom__") {
              setUseCustom(true);
            } else {
              setUseCustom(false);
              setCategory(v);
            }
          }}
          disabled={loading}
        >
          <SelectTrigger className="frosted mt-1">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent className="frosted text-(--text-primary)">
            {categories.length === 0 && (
              <SelectItem value="Uncategorized">Uncategorized</SelectItem>
            )}
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
            <SelectItem value="__custom__">New category...</SelectItem>
          </SelectContent>
        </Select>

        {useCustom && (
          <Input
            type="text"
            placeholder="Enter custom category"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            className="frosted mt-2"
            disabled={loading}
          />
        )}
      </div>

      <div className="pt-2">
        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading
              ? isEditing
                ? "Saving..."
                : "Subscribing..."
              : isEditing
                ? "Save"
                : "Subscribe"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  );
}
