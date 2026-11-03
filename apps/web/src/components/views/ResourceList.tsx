"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ViewResource, ViewResourcePage } from "@/lib/viewsApi";

const MAX_ATTRS_PER_CARD = 6;

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

function resourceAttributes(resource: ViewResource): Array<{ label: string; value: string }> {
  const data = resource.data ?? {};
  const attributes: Array<{ label: string; value: string }> = [];
  for (const [label, value] of Object.entries(data)) {
    if (attributes.length >= MAX_ATTRS_PER_CARD) break;
    if (["title", "name", "label", "description"].includes(label)) continue;
    const formatted = formatAttribute(value);
    if (formatted) attributes.push({ label, value: formatted });
  }
  return attributes;
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
}: {
  page: ViewResourcePage | undefined;
  className?: string;
}) {
  const resources = page?.items ?? [];

  if (!resources.length) {
    return (
      <div className={cn("frosted rounded-2xl p-8 text-center text-sm text-white/60", className)}>
        No resources returned
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
          const attributes = resourceAttributes(resource);
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
