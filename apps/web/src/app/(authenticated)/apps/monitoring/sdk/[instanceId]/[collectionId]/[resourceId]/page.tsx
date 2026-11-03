"use client";

import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { getSdkMonitoringResourcesAction } from "@/lib/apiClient";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import AppIcon from "@dashwise/app-icon";

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(password|secret|token|credential|authorization|api.?key)/i.test(key))
    .map(([key, child]) => [key, redact(child)]));
}

function safeEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as Array<[string, unknown]>;
  return Object.entries(redact(value) as Record<string, unknown>);
}

export default function SdkMonitoringResourcePage() {
  const { instanceId = "", collectionId = "", resourceId = "" } = useParams();
  const query = useApiQuery(queryKeys.monitoring.sdkResources, getSdkMonitoringResourcesAction);
  const resource = useMemo(() => (query.data ?? []).find((entry) =>
    entry.instanceId === instanceId && entry.collectionId === collectionId && entry.id === resourceId),
  [query.data, instanceId, collectionId, resourceId]);

  if (query.isLoading) return <div className="frosted rounded-xl p-5 text-sm text-white/65">Loading system resource…</div>;
  if (!resource) return <div className="frosted rounded-xl p-5 text-sm text-white/65">This monitored system is no longer available.</div>;
  const details = [...safeEntries(resource.state), ...safeEntries(resource.attributes)];

  return <div className="mx-auto w-full max-w-5xl space-y-4 pb-8">
    <header className="frosted rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <AppIcon source={resource.icon || "fa6-solid:server"} className="text-cyan-200" />
        <div>
          <h1 className="text-2xl font-semibold">{resource.name || resource.id}</h1>
          <p className="text-sm text-white/55">{resource.instanceName} · {resource.source} · {resource.collectionId}</p>
        </div>
      </div>
      {resource.state !== undefined && (typeof resource.state === "string" || typeof resource.state === "number") && (
        <p className="mt-4 text-sm text-white/75">Current state: {String(resource.state)}</p>
      )}
    </header>
    {details.length > 0 ? <section className="frosted rounded-xl p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-medium">System details</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {details.map(([key, value]) => <div key={key} className="rounded-md border border-white/10 px-3 py-2">
          <dt className="text-xs text-white/55">{key}</dt>
          <dd className="mt-1 break-words text-sm">{typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value)}</dd>
        </div>)}
      </dl>
    </section> : <div className="frosted rounded-xl p-5 text-sm text-white/55">This resource has no additional state or attributes yet.</div>}
  </div>;
}
