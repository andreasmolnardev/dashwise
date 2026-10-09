"use client";

import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import type { ActivityQuery, ActivitySeverity } from "@dashwise/types";
import AppTemplate, { Content, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import { ActivityRow } from "@/components/activity/ActivityStream";
import { safeActivityTarget } from "@/lib/activityUtils";
import { useActivityDetail, useActivityPage } from "@/hooks/useActivities";

const inputClass = "h-9 min-w-0 rounded-md border border-white/15 bg-black/20 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-primary";

export default function ActivityHistoryPage() {
  const { activityId } = useParams();
  return (
    <AppTemplate title="Activity">
      <Sidebar><Tab dst="/apps/activity" icon="fa6-solid:clock-rotate-left" title="History" isRoot /></Sidebar>
      <Content className="mx-auto w-full max-w-4xl">
        {activityId ? <ActivityDetail activityId={activityId} /> : <ActivityHistory />}
      </Content>
    </AppTemplate>
  );
}

function ActivityHistory() {
  const [filters, setFilters] = useState<ActivityQuery>({ page: 1, perPage: 20 });
  const query = useActivityPage(filters);
  const updateFilter = (patch: Partial<ActivityQuery>) => setFilters((current) => ({ ...current, ...patch, page: 1 }));

  return (
    <section className="space-y-5 text-white">
      <header>
        <h2 className="text-2xl font-semibold">Activity history</h2>
        <p className="mt-1 text-sm text-white/55">Events from integrations and Dashwise appear here.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="grid gap-1 text-xs text-white/60">Source
          <input aria-label="Filter by source" className={inputClass} value={filters.source ?? ""} onChange={(event) => updateFilter({ source: event.target.value || undefined })} placeholder="All sources" />
        </label>
        <label className="grid gap-1 text-xs text-white/60">Type
          <input aria-label="Filter by type" className={inputClass} value={filters.type ?? ""} onChange={(event) => updateFilter({ type: event.target.value || undefined })} placeholder="All types" />
        </label>
        <label className="grid gap-1 text-xs text-white/60">Severity
          <select aria-label="Filter by severity" className={inputClass} value={filters.severity ?? "all"} onChange={(event) => updateFilter({ severity: event.target.value === "all" ? undefined : event.target.value as ActivitySeverity })}>
            <option value="all">All severities</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-white/60">From
          <input aria-label="Filter from date" type="datetime-local" className={inputClass} value={filters.from?.slice(0, 16) ?? ""} onChange={(event) => updateFilter({ from: event.target.value ? new Date(event.target.value).toISOString() : undefined })} />
        </label>
        <label className="grid gap-1 text-xs text-white/60">To
          <input aria-label="Filter to date" type="datetime-local" className={inputClass} value={filters.to?.slice(0, 16) ?? ""} onChange={(event) => updateFilter({ to: event.target.value ? new Date(event.target.value).toISOString() : undefined })} />
        </label>
      </div>
      {query.isLoading ? <p className="py-8 text-center text-sm text-white/55">Loading activity…</p> : null}
      {query.isError ? <p role="alert" className="py-8 text-center text-sm text-rose-200">Activity history could not be loaded.</p> : null}
      {query.isSuccess && query.data.items.length === 0 ? <p className="py-8 text-center text-sm text-white/50">No matching activity.</p> : null}
      {query.data?.items.length ? <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-black/10 px-4">
        {query.data.items.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
      </div> : null}
      {query.data && query.data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/55">Page {query.data.page} of {query.data.totalPages}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-full border border-white/20 px-3 py-1.5 disabled:opacity-40" disabled={query.data.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page ?? 1) - 1) }))}>Previous</button>
            <button type="button" className="rounded-full border border-white/20 px-3 py-1.5 disabled:opacity-40" disabled={query.data.page >= query.data.totalPages} onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ActivityDetail({ activityId }: { activityId: string }) {
  const query = useActivityDetail(activityId);
  const actionTarget = safeActivityTarget(query.data?.action?.target);
  return (
    <section className="space-y-5 text-white">
      <Link to="/apps/activity" className="text-sm text-primary hover:underline">← Activity history</Link>
      {query.isLoading && <p className="py-8 text-sm text-white/55">Loading activity…</p>}
      {query.isError && <p role="alert" className="py-8 text-sm text-rose-200">This activity could not be loaded.</p>}
      {query.data && <article className="rounded-xl border border-white/10 bg-black/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold">{query.data.title}</h2>
          <time className="text-sm text-white/50" dateTime={query.data.occurredAt}>{new Date(query.data.occurredAt).toLocaleString()}</time>
        </div>
        <p className="mt-2 text-sm text-white/60">{query.data.source} · {query.data.type} · {query.data.severity}</p>
        {query.data.description && <p className="mt-5 whitespace-pre-wrap break-words text-white/85">{query.data.description}</p>}
        {actionTarget && query.data.action && <Link to={actionTarget} className="mt-5 inline-flex rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/10">{query.data.action.label}</Link>}
        {query.data.metadata && Object.keys(query.data.metadata).length > 0 && <div className="mt-6 border-t border-white/10 pt-4">
          <h3 className="text-sm font-medium">Details</h3>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3 text-xs text-white/65">{JSON.stringify(query.data.metadata, null, 2)}</pre>
        </div>}
      </article>}
    </section>
  );
}
