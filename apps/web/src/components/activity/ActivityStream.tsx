"use client";

import { Link } from "react-router-dom";
import type { ActivityRecord } from "@dashwise/types";
import { useActivityPage } from "@/hooks/useActivities";
import { formatActivityTime, safeActivityTarget } from "@/lib/activityUtils";

const severityColor: Record<ActivityRecord["severity"], string> = {
  info: "bg-sky-300",
  success: "bg-emerald-300",
  warning: "bg-amber-300",
  error: "bg-rose-400",
};

export function ActivityRow({ activity, compact = false }: { activity: ActivityRecord; compact?: boolean }) {
  const actionTarget = safeActivityTarget(activity.action?.target);
  return (
    <article className={`group relative flex gap-3 ${compact ? "py-2" : "py-4"}`}>
      <span aria-label={`${activity.severity} severity`} className={`mt-1.5 size-2 shrink-0 rounded-full ${severityColor[activity.severity]}`} />
      <div className="min-w-0 flex-1">
        <Link to={`/apps/activity/${encodeURIComponent(activity.id)}`} className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-white/90">{activity.title}</span>
            <time className="text-xs text-white/45" dateTime={activity.occurredAt}>{formatActivityTime(activity.occurredAt)}</time>
          </div>
          {!compact && activity.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/65">{activity.description}</p>}
          <p className="mt-1 text-xs text-white/45">{activity.source} · {activity.type}</p>
        </Link>
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
  const perPage = Math.max(1, Math.min(25, Number(maxItems) || 5));
  const query = useActivityPage({ page: 1, perPage, source: source?.trim() || undefined, type: type?.trim() || undefined });

  if (query.isLoading) return <p className="py-3 text-sm text-white/55">Loading activity…</p>;
  if (query.isError) return <p role="alert" className="py-3 text-sm text-rose-200">Activity could not be loaded.</p>;
  if (!query.data?.items.length) return <p className="py-3 text-sm text-white/50">No activity yet.</p>;

  return (
    <div className={compact ? "divide-y divide-white/10" : "divide-y divide-white/10"}>
      {query.data.items.slice(0, perPage).map((activity) => <ActivityRow key={activity.id} activity={activity} compact={compact} />)}
      <div className="pt-2 text-right">
        <Link to="/apps/activity" className="text-xs text-primary hover:underline">View activity history</Link>
      </div>
    </div>
  );
}
