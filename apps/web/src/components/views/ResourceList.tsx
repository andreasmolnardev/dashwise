"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ViewResource, ViewResourcePage } from "@/lib/viewsApi";

const MAX_ATTRS_PER_CARD = 6;
const DEFAULT_TABLE_COLUMNS = ["name", "type", "provider", "state", "updatedAt"];

type Renderer = "list" | "table" | "cards";

function rendererName(presentation: Record<string, unknown> | undefined): Renderer {
  const value = presentation?.type ?? presentation?.renderer;
  if (value === "table" || value === "cards") return value;
  // Older saved configs used `columns` without declaring a renderer.
  if (value === undefined && Array.isArray(presentation?.columns)) return "table";
  return "list";
}

function configuredColumns(presentation: Record<string, unknown> | undefined): string[] {
  const columns = presentation?.columns;
  return Array.isArray(columns)
    ? columns.filter((column): column is string => typeof column === "string" && column.trim() !== "").map((column) => column.trim())
    : [];
}

/** Picks a display title for a resource without assuming a schema. */
function resourceTitle(resource: ViewResource): string {
  const data = resource.data ?? {};
  for (const key of ["title", "name", "label", "hostname", "url"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return resource.providerResourceId || resource.id;
}

function formatAttribute(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const formatted = value.map(formatAttribute).filter(Boolean);
    if (formatted.length) return formatted.join(", ");
  }
  return null;
}

function resourceAttributes(resource: ViewResource, selectedFields?: string[]): Array<{ label: string; value: string }> {
  const data = resource.data ?? {};
  const attributes: Array<{ label: string; value: string }> = [];
  const entries = selectedFields?.length
    ? selectedFields.flatMap((label) => label in data ? [[label, data[label]] as [string, unknown]] : [])
    : Object.entries(data);
  for (const [label, value] of entries) {
    if (attributes.length >= MAX_ATTRS_PER_CARD) break;
    if (["title", "name", "label", "description"].includes(label)) continue;
    const formatted = formatAttribute(value);
    if (formatted) attributes.push({ label, value: formatted });
  }
  return attributes;
}

function resourceField(resource: ViewResource, field: string): unknown {
  if (field === "name" || field === "title") return resourceTitle(resource);
  if (field === "id") return resource.id;
  if (field === "type" || field === "provider" || field === "state" || field === "createdAt" || field === "updatedAt" || field === "providerResourceId") {
    return resource[field];
  }
  return resource.data?.[field];
}

function tableValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fieldLabel(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

/** Badge for a resource lifecycle state. */
function StateBadge({ state }: { state: string }) {
  const label = state === "current" ? "" : state;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] px-1.5 py-0 rounded-md border border-white/10 text-white/75",
        state === "error" && "text-red-300 border-red-300/30",
        state === "stale" && "text-amber-200 border-amber-200/30",
      )}
    >
      {label || "current"}
    </Badge>
  );
}

export default function ResourceList({
  page,
  className,
  presentation,
}: {
  page: ViewResourcePage | undefined;
  className?: string;
  presentation?: Record<string, unknown>;
}) {
  const resources = page?.items ?? [];
  const renderer = rendererName(presentation);
  const columns = configuredColumns(presentation);

  if (!resources.length) {
    return (
      <div className={cn("frosted rounded-2xl p-8 text-center text-sm text-white/60", className)}>
        No resources returned
      </div>
    );
  }

  if (renderer === "table") {
    const displayedColumns = columns.length ? columns : DEFAULT_TABLE_COLUMNS;
    return (
      <div className={cn("space-y-2", className)}>
        <p className="px-1 text-xs text-white/50">
          {page!.total} total · showing {resources.length} at offset {page!.offset}
        </p>
        <div className="frosted overflow-x-auto rounded-2xl">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-white/5 text-white/55">
              <tr>{displayedColumns.map((field) => <th key={field} className="border-b border-white/10 px-3 py-2 font-medium">{fieldLabel(field)}</th>)}</tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  {displayedColumns.map((field) => (
                    <td key={field} className="max-w-80 whitespace-pre-wrap break-words px-3 py-2 text-white/80">
                      {tableValue(resourceField(resource, field))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (renderer === "list") {
    return (
      <div className={cn("space-y-2", className)}>
        <p className="px-1 text-xs text-white/50">
          {page!.total} total · showing {resources.length} at offset {page!.offset}
        </p>
        <div className="space-y-1.5">
          {resources.map((resource) => {
            const attributes = resourceAttributes(resource, columns);
            return (
              <div key={resource.id} className="frosted flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl px-3 py-2.5">
                <div className="min-w-44">
                  <p className="break-words text-sm font-medium text-white/90">{resourceTitle(resource)}</p>
                  <p className="mt-0.5 text-[10px] text-white/45">{resource.type} · {resource.provider}</p>
                </div>
                <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
                  {attributes.map(({ label, value }) => (
                    <p key={label} className="text-xs text-white/65"><span className="text-white/40">{fieldLabel(label)}:</span> {value}</p>
                  ))}
                </div>
                <StateBadge state={resource.state} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-white/50 px-1">
        {page!.total} total · showing {resources.length} at offset {page!.offset}
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {resources.map((resource) => {
          const attributes = resourceAttributes(resource, columns);
          return (
            <div
              key={resource.id}
              className="frosted rounded-2xl p-4 space-y-2 hover:bg-white/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-tight break-words">
                  {resourceTitle(resource)}
                </p>
                <StateBadge state={resource.state} />
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 rounded-md border border-white/10 text-white/75">
                  {resource.type}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 rounded-md border border-white/10 text-white/75">
                  {resource.provider}
                </Badge>
                {(resource.capabilities ?? []).slice(0, 3).map((capability) => (
                  <span key={capability} className="text-[10px] text-white/50 leading-none self-center">
                    {capability}
                  </span>
                ))}
              </div>
              {attributes.length > 0 && (
                <dl className="grid gap-x-4 gap-y-1 grid-cols-[auto_1fr] text-xs">
                  {attributes.map((attribute) => (
                    <div key={attribute.label} className="col-span-2 grid grid-cols-subgrid">
                      <dt className="font-mono text-white/45">{attribute.label}</dt>
                      <dd className="text-white/80 break-words">{attribute.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
