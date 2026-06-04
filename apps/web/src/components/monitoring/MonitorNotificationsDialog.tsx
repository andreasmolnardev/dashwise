"use client";

import { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import type { MonitorRecord } from "@dashwise/types/sdk/data/monitoring";
import { updateMonitorAction } from "@/app/actions/monitoring";
import { getNotificationTopicsAction, createNotificationTopicAction, sendTestNotificationAction } from "@/app/actions/notifications/items";
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
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setEnabled(Boolean(monitor?.notifyOnStatusChange));
    setError(null);
    setTestSuccess(false);

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

  const handleTest = async () => {
    if (!token || !selectedTopic) return;

    setTesting(true);
    setError(null);
    setTestSuccess(false);

    try {
      let topic = selectedTopic;
      if (!topics.some((entry) => entry.id === topic?.id)) {
        const created = await withAuth((auth) => createNotificationTopicAction(auth, topic!.title));
        topic = { id: String((created as any)?.topicId ?? topic.id), title: topic.title };
        setTopics([...topics, topic]);
        setSelectedTopic(topic);
      }

      await withAuth((auth) => sendTestNotificationAction(auth, topic.id));
      setTestSuccess(true);
    } catch (testError) {
      console.error("Failed to send test notification:", testError);
      setError(testError instanceof Error ? testError.message : "Failed to send test notification");
    } finally {
      setTesting(false);
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

          <label className="flex items-center gap-3">
            <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(Boolean(checked))} />
            Enable notifications on status changes
          </label>

          <div className="space-y-2">
            <label className="text-sm font-medium">Topic</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <TopicCombobox
                  topics={topics}
                  value={selectedTopic}
                  onChange={(val) => {
                    setSelectedTopic(val);
                    setTestSuccess(false);
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !selectedTopic}
                className="h-10"
              >
                {testing ? "Sending..." : "Test"}
              </Button>
            </div>
            {testSuccess && <p className="text-xs text-green-400">Test notification sent!</p>}
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
