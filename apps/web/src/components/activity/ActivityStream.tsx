"use client";

import { useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityRecord } from "@dashwise/types";
import { useActivityDetail, useActivityPage } from "@/hooks/useActivities";
import { formatActivityTime, safeActivityTarget } from "@/lib/activityUtils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const severityColor: Record<ActivityRecord["severity"], string> = {
  info: "bg-sky-300",
  success: "bg-emerald-300",
  warning: "bg-amber-300",
  error: "bg-rose-400",
};

export function ActivityRow({ activity, compact = false, onOpenDetail }: { activity: ActivityRecord; compact?: boolean; onOpenDetail: (activityId: string) => void }) {
  const actionTarget = safeActivityTarget(activity.action?.target);
  return (
    <article className={`group relative flex gap-3 ${compact ? "py-2" : "py-4"}`}>
      <span aria-label={`${activity.severity} severity`} className={`mt-1.5 size-2 shrink-0 rounded-full ${severityColor[activity.severity]}`} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpenDetail(activity.id)} className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-white/90">{activity.title}</span>
            <time className="text-xs text-white/45" dateTime={activity.occurredAt}>{formatActivityTime(activity.occurredAt)}</time>
          </span>
          {!compact && activity.description && <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-white/65">{activity.description}</span>}
          <span className="mt-1 block text-xs text-white/45">{activity.source} · {activity.type}</span>
        </button>
        {actionTarget && activity.action && (
          <Link to={actionTarget} className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>
            {activity.action.label}
          </Link>
        )}
      </div>
    </article>
  );
}

export default function ActivityStream({ maxItems = 5, source, type, compact = false }: {
  maxItems?: number;
  source?: string;
  type?: string;
  compact?: boolean;
}) {
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const perPage = Math.max(1, Math.min(25, Number(maxItems) || 5));
  const query = useActivityPage({ page: 1, perPage, source: source?.trim() || undefined, type: type?.trim() || undefined });
  const detailQuery = useActivityDetail(selectedActivityId ?? "");
  const detailActionTarget = safeActivityTarget(detailQuery.data?.action?.target);

  if (query.isLoading) return <p className="py-3 text-sm text-white/55">Loading activity…</p>;
  if (query.isError) return <p role="alert" className="py-3 text-sm text-rose-200">Activity could not be loaded.</p>;

  return (
    <>
      {!query.data?.items.length ? <p className="py-3 text-sm text-white/50">No activity yet.</p> : (
        <div className="divide-y divide-white/10">
          {query.data.items.slice(0, perPage).map((activity) => <ActivityRow key={activity.id} activity={activity} compact={compact} onOpenDetail={setSelectedActivityId} />)}
        </div>
      )}
      <Dialog open={selectedActivityId !== null} onOpenChange={(open) => { if (!open) setSelectedActivityId(null); }}>
        <DialogContent className="frosted text-foreground">
          <DialogHeader>
            <DialogTitle>{detailQuery.data?.title ?? "Activity details"}</DialogTitle>
            <DialogDescription>Details for this activity event.</DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && <p className="text-sm text-muted-foreground">Loading activity…</p>}
          {detailQuery.isError && <p role="alert" className="text-sm text-rose-300">This activity could not be loaded.</p>}
          {detailQuery.data && <article className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-muted-foreground">
              <span>{detailQuery.data.source} · {detailQuery.data.type} · {detailQuery.data.severity}</span>
              <time dateTime={detailQuery.data.occurredAt}>{new Date(detailQuery.data.occurredAt).toLocaleString()}</time>
            </div>
            {detailQuery.data.description && <p className="whitespace-pre-wrap break-words">{detailQuery.data.description}</p>}
            {detailQuery.data.metadata && Object.keys(detailQuery.data.metadata).length > 0 && <div className="border-t border-white/10 pt-3">
              <h3 className="font-medium">Details</h3>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3 text-xs">{JSON.stringify(detailQuery.data.metadata, null, 2)}</pre>
            </div>}
            {detailActionTarget && detailQuery.data.action && <Link to={detailActionTarget} className="inline-flex rounded-full border border-white/20 px-4 py-2 hover:bg-white/10">{detailQuery.data.action.label}</Link>}
          </article>}
        </DialogContent>
      </Dialog>
    </>
  );
}
