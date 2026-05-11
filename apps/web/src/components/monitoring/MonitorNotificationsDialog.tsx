"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import { updateMonitorAction, type MonitorRecord } from "@/app/actions/monitoring";
import { getNotificationTopicsAction, createNotificationTopicAction } from "@/app/actions/notifications/items";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TopicCombobox, { type Topic } from "@/components/notifications/TopicCombobox";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor: MonitorRecord | null;
  onUpdated?: (monitor: MonitorRecord) => void;
};

export default function MonitorNotificationsDialog({ open, onOpenChange, monitor, onUpdated }: Props) {
  const { token, withAuth } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setEnabled(Boolean(monitor?.notifyOnStatusChange));
    setError(null);

    let mounted = true;

    const loadTopics = async () => {
      try {
        const data = await withAuth((auth) => getNotificationTopicsAction(auth));
        if (!mounted) return;
        setTopics(Array.isArray(data)
          ? data.map((topic: any) => ({ id: String(topic.id), title: String(topic.title || topic.name || topic.id) }))
          : []);
        if (monitor?.notifyTopicId) {
          const topic = Array.isArray(data)
            ? data.map((entry: any) => ({ id: String(entry.id), title: String(entry.title || entry.name || entry.id) }))
                .find((entry: Topic) => entry.id === monitor.notifyTopicId)
            : null;
          setSelectedTopic(topic ?? { id: monitor.notifyTopicId, title: monitor.notifyTopicId });
        } else {
          setSelectedTopic(null);
        }
      } catch (loadError) {
        console.error("Failed to load notification topics:", loadError);
        if (mounted) {
          setTopics([]);
        }
      }
    };

    void loadTopics();

    return () => {
      mounted = false;
    };
  }, [open, monitor, withAuth]);

  const handleSave = async () => {
    if (!token || !monitor) return;

    setSaving(true);
    setError(null);

    try {
      let topic = selectedTopic;
      if (enabled && topic && !topics.some((entry) => entry.id === topic?.id)) {
        const created = await withAuth((auth) => createNotificationTopicAction(auth, topic!.title));
        topic = { id: String((created as any)?.topicId ?? topic.id), title: topic.title };
      }

      const updated = await withAuth((auth) =>
        updateMonitorAction(auth, monitor.id, {
          notifyOnStatusChange: enabled,
          notifyTopicId: enabled ? topic?.id ?? "" : "",
        })
      );

      if (updated) {
        onUpdated?.(updated as MonitorRecord);
        onOpenChange(false);
      }
    } catch (saveError) {
      console.error("Failed to save notification settings:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Failed to save notification settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,95%)] text-foreground frosted">
        <DialogHeader>
          <DialogTitle>Status change notifications</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(Boolean(checked))} />
            Enable notifications on status changes
          </label>

          <div className="space-y-2">
            <label className="text-sm font-medium">Topic</label>
            <TopicCombobox
              topics={topics}
              value={selectedTopic}
              onChange={setSelectedTopic}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
