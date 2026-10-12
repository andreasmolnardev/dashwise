"use client";

import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { getSdkIntegrationResourcesAction, type SdkResourceRecord } from "@/lib/apiClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = Record<string, unknown> & { type?: string; label?: string; description?: string; required?: boolean };

function getSchemaFields(schema: Record<string, unknown>): Array<[string, Field]> {
  const schemaProperties = schema.properties;
  const properties = schemaProperties && typeof schemaProperties === "object" && !Array.isArray(schemaProperties)
    ? schemaProperties as Record<string, unknown>
    : schema;
  const requiredKeys = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );

  return Object.entries(properties).flatMap(([key, rawField]) => {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) return [];
    const source = rawField as Record<string, unknown>;
    const enumValues = Array.isArray(source.enum) ? source.enum : null;
    const type = enumValues
      ? "select"
      : source.type === "integer"
        ? "number"
        : source.type === "string" && source.format === "uri"
          ? "url"
          : typeof source.type === "string"
            ? source.type
            : undefined;
    const options = enumValues?.map((value) => ({ label: String(value), value }));
    return [[key, {
      ...source,
      type,
      label: typeof source.label === "string" ? source.label : typeof source.title === "string" ? source.title : key,
      required: source.required === true || requiredKeys.has(key),
      ...(options ? { options } : {}),
    } as Field]];
  });
}

export default function SdkContributionConfigForm({
  instanceId,
  schema,
  value,
  onChange,
}: {
  instanceId: string;
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { withAuth } = useAuth();
  const [resources, setResources] = useState<SdkResourceRecord[]>([]);
  const schemaFields = useMemo(() => getSchemaFields(schema), [schema]);
  useEffect(() => {
    let cancelled = false;
    void withAuth((auth) => getSdkIntegrationResourcesAction(auth, instanceId))
      .then((next) => { if (!cancelled) setResources(next); })
      .catch(() => { if (!cancelled) setResources([]); });
    return () => { cancelled = true; };
  }, [instanceId, withAuth]);

  const setField = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  const allShortcuts = useMemo(() => resources.filter((resource) => resource.available !== false), [resources]);

  return (
    <div className="space-y-4">
      {schemaFields.map(([key, field]) => {
        const label = field.label ?? key;
        const fieldId = `sdk-contribution-${key}`;
        const selectedResources = allShortcuts.filter((resource) =>
          (!Array.isArray(field.collectionIds) || field.collectionIds.length === 0 || field.collectionIds.includes(resource.collectionId))
          && (!Array.isArray(field.appIds) || field.appIds.length === 0 || field.appIds.some((appId) => resource.apps?.includes(String(appId)))),
        );
        const currentValue = value[key] ?? field.default;

        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={fieldId}>{String(label)}{field.required ? " *" : ""}</Label>
            {field.type === "shortcut-select" ? field.multiple === true ? (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-white/10 p-2">
                {selectedResources.map((resource) => {
                  const selected = Array.isArray(currentValue) && currentValue.includes(resource.id);
                  return (
                    <label key={`${resource.collectionId}:${resource.id}`} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/10">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setField(key, selected
                          ? (currentValue as string[]).filter((id) => id !== resource.id)
                          : [...(Array.isArray(currentValue) ? currentValue as string[] : []), resource.id])}
                      />
                      <span className="min-w-0 flex-1 truncate">{resource.name}</span>
                      <span className="shrink-0 text-xs text-white/45">{resource.collectionId}</span>
                    </label>
                  );
                })}
                {selectedResources.length === 0 && <p className="p-2 text-sm text-white/50">No matching resources are available.</p>}
              </div>
            ) : (
              <select id={fieldId} value={String(currentValue ?? "")} onChange={(event) => setField(key, event.target.value || undefined)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select a resource…</option>
                {selectedResources.map((resource) => <option key={`${resource.collectionId}:${resource.id}`} value={resource.id}>{resource.name}</option>)}
              </select>
            ) : field.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm">
                <input id={fieldId} type="checkbox" checked={Boolean(currentValue)} onChange={(event) => setField(key, event.target.checked)} />
                Enabled
              </label>
            ) : field.type === "select" ? (
              <select id={fieldId} value={String(currentValue ?? "")} onChange={(event) => setField(key, event.target.value || undefined)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select…</option>
                {(Array.isArray(field.options) ? field.options : []).map((rawOption) => {
                  const option = rawOption as { label?: string; value?: unknown };
                  return <option key={String(option.value)} value={String(option.value)}>{option.label ?? String(option.value)}</option>;
                })}
              </select>
            ) : (
              <Input
                id={fieldId}
                type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
                required={field.required === true}
                value={String(currentValue ?? "")}
                onChange={(event) => setField(key, field.type === "number" ? Number(event.target.value) : event.target.value)}
                min={typeof field.min === "number" ? field.min : undefined}
                max={typeof field.max === "number" ? field.max : undefined}
                step={typeof field.step === "number" ? field.step : undefined}
              />
            )}
            {field.description && <p className="text-xs text-white/50">{String(field.description)}</p>}
          </div>
        );
      })}
      {Object.keys(schema).length === 0 && <p className="text-sm text-white/55">No configurable properties for this contribution.</p>}
    </div>
  );
}
