"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@iconify-icon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import useAuth from "@/context/useAuth";
import { authHeaders, backendUrl } from "@/lib/apiClient";

type ActivityOption = { label: string; value: string | number };
type ActivityConfigField = {
  key: string;
  label: string;
  description?: string;
  type: "boolean" | "number" | "text" | "select" | "topics";
  min?: number;
  max?: number;
  step?: number;
  options?: ActivityOption[];
};

export type ActivityDefinition = {
  id: string;
  title: string;
  description?: string;
  source: "builtin" | "integration" | "user" | string;
  sourceId?: string;
  conditionId?: string;
  sourceName?: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  configFields?: ActivityConfigField[];
  configSchema?: { fields?: ActivityConfigField[] };
  activeCount?: number;
  availabilityReason?: string;
};

type ResourceCatalogEntry = {
  instanceId: string;
  instanceName: string;
  collectionId: string;
  resourceId?: string;
  name: string;
  fields: string[];
};

type DefinitionResponse = { definitions: ActivityDefinition[]; resourceCatalog?: ResourceCatalogEntry[] };

type ResourceConditionDraft = {
  title: string;
  description: string;
  instanceId: string;
  collectionId: string;
  resourceId: string;
  fieldPath: string;
  operator: string;
  value: string;
  severity: string;
  notificationTopics: string[];
};

const CONDITION_OPERATORS = [
  ["equals", "Equals"],
  ["notEquals", "Does not equal"],
  ["greaterThan", "Greater than"],
  ["greaterThanOrEqual", "Greater than or equal to"],
  ["lessThan", "Less than"],
  ["lessThanOrEqual", "Less than or equal to"],
  ["contains", "Contains"],
  ["truthy", "Is true"],
  ["exists", "Exists"],
] as const;

const emptyConditionDraft: ResourceConditionDraft = {
  title: "",
  description: "",
  instanceId: "",
  collectionId: "",
  resourceId: "",
  fieldPath: "",
  operator: "equals",
  value: "",
  severity: "warning",
  notificationTopics: [],
};

function collectionKey(entry: Pick<ResourceCatalogEntry, "instanceId" | "collectionId">) {
  return `${entry.instanceId}\u0000${entry.collectionId}`;
}

function conditionValue(value: string) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value;
}

function sourceTitle(source: string) {
  if (source === "builtin") return "Dashwise";
  if (source === "integration") return "Integrations";
  if (source === "user") return "Your conditions";
  return source;
}

function fieldsFor(definition: ActivityDefinition) {
  return definition.configFields ?? definition.configSchema?.fields ?? [];
}

async function readError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : `Request failed (${response.status})`;
}

export default function ActivitiesSettings() {
  const { token, withAuth } = useAuth();
  const [definitions, setDefinitions] = useState<ActivityDefinition[]>([]);
  const [resourceCatalog, setResourceCatalog] = useState<ResourceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conditionDraft, setConditionDraft] = useState<ResourceConditionDraft>(emptyConditionDraft);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void withAuth(async (auth) => {
      const response = await fetch(backendUrl("/api/v1/activities/definitions"), {
        headers: authHeaders(auth),
      });
      if (!response.ok) throw new Error(await readError(response));
      return await response.json() as DefinitionResponse;
    }).then((result) => {
      if (!cancelled) {
        setDefinitions(result.definitions ?? []);
        setResourceCatalog(result.resourceCatalog ?? []);
      }
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [token, withAuth]);

  const groups = useMemo(() => {
    const order = ["builtin", "integration", "user"];
    const bySource = new Map<string, ActivityDefinition[]>();
    for (const definition of definitions) {
      const group = bySource.get(definition.source) ?? [];
      group.push(definition);
      bySource.set(definition.source, group);
    }
    return [...bySource.entries()].sort(([left], [right]) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
    });
  }, [definitions]);

  const collections = useMemo(() => {
    const unique = new Map<string, ResourceCatalogEntry>();
    for (const entry of resourceCatalog) {
      const key = collectionKey(entry);
      if (!unique.has(key)) unique.set(key, entry);
    }
    return [...unique.values()].sort((a, b) => `${a.instanceName} ${a.name}`.localeCompare(`${b.instanceName} ${b.name}`));
  }, [resourceCatalog]);
  const selectedCollection = collections.find((entry) => collectionKey(entry) === collectionKey(conditionDraft));
  const collectionResources = resourceCatalog.filter((entry) =>
    entry.instanceId === conditionDraft.instanceId && entry.collectionId === conditionDraft.collectionId,
  );
  const selectedResource = collectionResources.find((entry) => entry.resourceId === conditionDraft.resourceId);
  const conditionFields = [...new Set((conditionDraft.resourceId && selectedResource
    ? selectedResource.fields
    : collectionResources.flatMap((entry) => entry.fields)).filter(Boolean))].sort();

  function updateConditionDraft(patch: Partial<ResourceConditionDraft>) {
    setConditionDraft((current) => ({ ...current, ...patch }));
  }

  async function createResourceCondition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !conditionDraft.instanceId || !conditionDraft.collectionId || !conditionDraft.fieldPath) return;
    setSaving((current) => ({ ...current, "new-resource-condition": true }));
    setError(null);
    setNotice(null);
    const payload = {
      title: conditionDraft.title.trim(),
      ...(conditionDraft.description.trim() ? { description: conditionDraft.description.trim() } : {}),
      instanceId: conditionDraft.instanceId,
      collectionId: conditionDraft.collectionId,
      ...(conditionDraft.resourceId ? { resourceId: conditionDraft.resourceId } : {}),
      fieldPath: conditionDraft.fieldPath,
      operator: conditionDraft.operator,
      ...(["truthy", "exists"].includes(conditionDraft.operator) ? {} : { value: conditionValue(conditionDraft.value) }),
      severity: conditionDraft.severity,
      notificationTopics: conditionDraft.notificationTopics,
    };
    try {
      const definition = await withAuth(async (auth) => {
        const response = await fetch(backendUrl("/api/v1/activities/definitions/resource-conditions"), {
          method: "POST",
          headers: { ...authHeaders(auth), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json() as { definition: ActivityDefinition }).definition;
      });
      setDefinitions((current) => [...current, definition]);
      setConditionDraft(emptyConditionDraft);
      setNotice("Resource condition created.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving((current) => ({ ...current, "new-resource-condition": false }));
    }
  }

  async function deleteResourceCondition(definition: ActivityDefinition) {
    if (!token || saving[definition.id]) return;
    setSaving((current) => ({ ...current, [definition.id]: true }));
    setError(null);
    setNotice(null);
    try {
      await withAuth(async (auth) => {
        const conditionId = definition.conditionId ?? definition.id.replace(/^condition:/, "");
        const response = await fetch(backendUrl(`/api/v1/activities/definitions/resource-conditions/${encodeURIComponent(conditionId)}`), {
          method: "DELETE",
          headers: authHeaders(auth),
        });
        if (!response.ok) throw new Error(await readError(response));
      });
      setDefinitions((current) => current.filter((item) => item.id !== definition.id));
      setNotice("Resource condition removed.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSaving((current) => ({ ...current, [definition.id]: false }));
    }
  }

  async function saveDefinition(id: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) {
    if (!token) return;
    setSaving((current) => ({ ...current, [id]: true }));
    setError(null);
    setNotice(null);
    try {
      const updated = await withAuth(async (auth) => {
        const response = await fetch(backendUrl(`/api/v1/activities/definitions/${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: { ...authHeaders(auth), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error(await readError(response));
        const body = await response.json() as { definition?: ActivityDefinition };
        return body.definition;
      });
      setDefinitions((current) => current.map((item) => item.id === id ? { ...item, ...(updated ?? patch) } : item));
      if (patch.config) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
      setNotice("Activity settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving((current) => ({ ...current, [id]: false }));
    }
  }

  function updateDraft(definition: ActivityDefinition, key: string, value: unknown) {
    setDrafts((current) => ({
      ...current,
      [definition.id]: { ...(current[definition.id] ?? definition.config ?? {}), [key]: value },
    }));
  }

  return (
    <section className="space-y-4 pb-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Activities</h1>
        <p className="max-w-3xl text-sm text-white/70">
          Activities show conditions that matter right now. They appear while a condition holds and clear when it is resolved.
        </p>
      </header>

      {error && <div role="alert" className="rounded-md border border-red-300/30 bg-red-500/10 p-3 text-sm">{error}</div>}
      {notice && <p role="status" className="text-sm text-white/70">{notice}</p>}

      <section className="frosted rounded-md border border-white/10 p-3 shadow-sm">
        <h2 className="text-xl font-semibold">Add a resource condition</h2>
        <p className="mb-3 mt-1 text-sm text-white/70">
          Create an activity from a condition on a resource exposed by an SDK integration. Choose a resource or apply it to every resource in its collection.
        </p>
        {loading ? (
          <p className="rounded-md border border-white/10 p-3 text-sm text-white/60">Loading SDK resources…</p>
        ) : resourceCatalog.length === 0 ? (
          <p className="rounded-md border border-white/10 p-3 text-sm text-white/60">No SDK resources are available. Configure and sync an SDK integration to create a resource condition.</p>
        ) : (
          <form className="space-y-3" onSubmit={(event) => void createResourceCondition(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="resource-condition-title">Activity title</Label>
                <Input id="resource-condition-title" required maxLength={120} value={conditionDraft.title} onChange={(event) => updateConditionDraft({ title: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="resource-condition-severity">Severity</Label>
                <select id="resource-condition-severity" className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm" value={conditionDraft.severity} onChange={(event) => updateConditionDraft({ severity: event.target.value })}>
                  <option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Error</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="resource-condition-description">Description <span className="text-white/50">(optional)</span></Label>
                <Input id="resource-condition-description" maxLength={500} value={conditionDraft.description} onChange={(event) => updateConditionDraft({ description: event.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="resource-condition-topics">Related notification topics <span className="text-white/50">(optional)</span></Label>
                <select id="resource-condition-topics" multiple className="min-h-20 w-full rounded-md border border-white/20 bg-black/20 px-3 py-2 text-sm" value={conditionDraft.notificationTopics} onChange={(event) => updateConditionDraft({ notificationTopics: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                  {(definitions.find(({ id }) => id === "calendar.upcoming")?.configFields?.find(({ key }) => key === "notificationTopics")?.options ?? []).map((option) => <option key={option.value} value={String(option.value)}>{option.label}</option>)}
                </select>
                <p className="text-xs text-white/50">The condition appears only while one of these topics has unread notifications.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resource-condition-collection">Integration and collection</Label>
                <select
                  id="resource-condition-collection"
                  required
                  className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm"
                  value={conditionDraft.instanceId && conditionDraft.collectionId ? collectionKey(conditionDraft) : ""}
                  onChange={(event) => {
                    const next = collections.find((entry) => collectionKey(entry) === event.target.value);
                    updateConditionDraft({ instanceId: next?.instanceId ?? "", collectionId: next?.collectionId ?? "", resourceId: "", fieldPath: "" });
                  }}
                >
                  <option value="">Choose a collection…</option>
                  {collections.map((entry) => <option key={collectionKey(entry)} value={collectionKey(entry)}>{entry.instanceName} · {entry.collectionId}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resource-condition-resource">Resource scope</Label>
                <select
                  id="resource-condition-resource"
                  className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm"
                  value={conditionDraft.resourceId}
                  disabled={!selectedCollection}
                  onChange={(event) => updateConditionDraft({ resourceId: event.target.value, fieldPath: "" })}
                >
                  <option value="">Every resource in this collection</option>
                  {collectionResources.filter((entry) => entry.resourceId).map((entry) => <option key={entry.resourceId} value={entry.resourceId}>{entry.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resource-condition-field">Field</Label>
                <select id="resource-condition-field" required className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm" value={conditionDraft.fieldPath} disabled={!selectedCollection} onChange={(event) => updateConditionDraft({ fieldPath: event.target.value })}>
                  <option value="">Choose a field…</option>
                  {conditionFields.map((field) => <option key={field} value={field}>{field}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="resource-condition-operator">Condition</Label>
                <select id="resource-condition-operator" className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm" value={conditionDraft.operator} onChange={(event) => updateConditionDraft({ operator: event.target.value })}>
                  {CONDITION_OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              {!(["truthy", "exists"].includes(conditionDraft.operator)) && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="resource-condition-value">Value</Label>
                  <Input id="resource-condition-value" required value={conditionDraft.value} onChange={(event) => updateConditionDraft({ value: event.target.value })} />
                  <p className="text-xs text-white/55">Numbers and true/false are converted to their matching value types.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={Boolean(saving["new-resource-condition"]) || !conditionDraft.instanceId || !conditionDraft.fieldPath}>
                {saving["new-resource-condition"] ? "Creating…" : "Add condition"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {loading ? (
        <div className="frosted rounded-md p-4 text-sm text-white/70">Loading activity definitions…</div>
      ) : definitions.length === 0 ? (
        <div className="frosted rounded-md p-4 text-sm text-white/70">
          No activity definitions are available yet. Built-in and integration definitions will appear here when their sources are configured.
        </div>
      ) : (
        groups.map(([source, entries]) => (
          <section key={source} aria-label={`${sourceTitle(source)} activities`} className="space-y-2">
            <h2 className="text-xl font-semibold">{sourceTitle(source)}</h2>
            <div className="space-y-2">
              {entries.map((definition) => {
                const fields = fieldsFor(definition);
                const values = drafts[definition.id] ?? definition.config ?? {};
                const isSaving = Boolean(saving[definition.id]);
                return (
                  <article key={definition.id} className="frosted rounded-md border border-white/10 p-3 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="font-medium">{definition.title}</h3>
                          {typeof definition.activeCount === "number" && definition.activeCount > 0 && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                              {definition.activeCount} active
                            </span>
                          )}
                          {definition.source === "integration" && definition.sourceName && (
                            <span className="text-xs text-white/55">{definition.sourceName}</span>
                          )}
                        </div>
                        {definition.description && <p className="text-sm text-white/70">{definition.description}</p>}
                        {definition.availabilityReason && <p className="text-xs text-white/55">{definition.availabilityReason}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Label htmlFor={`activity-enabled-${definition.id}`} className="text-xs text-white/70">
                          {definition.enabled ? "On" : "Off"}
                        </Label>
                        <Switch
                          id={`activity-enabled-${definition.id}`}
                          checked={definition.enabled}
                          disabled={isSaving || Boolean(definition.availabilityReason)}
                          aria-label={`Enable ${definition.title}`}
                          onCheckedChange={(enabled) => void saveDefinition(definition.id, { enabled })}
                        />
                        {definition.source === "user" && (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${definition.title}`} disabled={isSaving} onClick={() => void deleteResourceCondition(definition)}>
                            <Icon icon="fa6-solid:trash" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {fields.length > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {fields.map((field) => {
                            const value = values[field.key];
                            const fieldId = `activity-${definition.id}-${field.key}`;
                            if (field.type === "boolean") {
                              return <div key={field.key} className="flex items-center justify-between gap-3 rounded-md border border-white/10 px-3 py-2">
                                <div><Label htmlFor={fieldId}>{field.label}</Label>{field.description && <p className="text-xs text-white/60">{field.description}</p>}</div>
                                <Switch id={fieldId} checked={Boolean(value)} disabled={isSaving || Boolean(definition.availabilityReason)} onCheckedChange={(next) => updateDraft(definition, field.key, next)} />
                              </div>;
                            }
                            if (field.type === "select") {
                              return <div key={field.key} className="space-y-1">
                                <Label htmlFor={fieldId}>{field.label}</Label>
                                <select id={fieldId} className="h-9 w-full rounded-md border border-white/20 bg-black/20 px-3 text-sm" value={String(value ?? "")} disabled={isSaving || Boolean(definition.availabilityReason)} onChange={(event) => updateDraft(definition, field.key, event.target.value)}>
                                  {field.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                                </select>
                                {field.description && <p className="text-xs text-white/60">{field.description}</p>}
                              </div>;
                            }
                            if (field.type === "topics") {
                              const selected = Array.isArray(value) ? value.map(String) : [];
                              return <div key={field.key} className="space-y-1 sm:col-span-2">
                                <Label>{field.label}</Label>
                                <div className="flex flex-wrap gap-2">
                                  {field.options?.map((option) => {
                                    const topic = String(option.value);
                                    const checked = selected.includes(topic);
                                    return <label key={topic} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${checked ? "border-primary/50 bg-primary/10" : "border-white/10"}`}>
                                      <input type="checkbox" checked={checked} disabled={isSaving || Boolean(definition.availabilityReason)} onChange={() => updateDraft(definition, field.key, checked ? selected.filter((item) => item !== topic) : [...selected, topic])} />
                                      {option.label}
                                    </label>;
                                  })}
                                </div>
                                {field.description && <p className="text-xs text-white/60">{field.description}</p>}
                              </div>;
                            }
                            return <div key={field.key} className="space-y-1">
                              <Label htmlFor={fieldId}>{field.label}</Label>
                              <Input
                                id={fieldId}
                                type={field.type === "number" ? "number" : "text"}
                                min={field.min}
                                max={field.max}
                                step={field.step}
                                value={String(value ?? "")}
                                disabled={isSaving || Boolean(definition.availabilityReason)}
                                onChange={(event) => updateDraft(definition, field.key, field.type === "number" ? Number(event.target.value) : event.target.value)}
                              />
                              {field.description && <p className="text-xs text-white/60">{field.description}</p>}
                            </div>;
                          })}
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button type="button" size="sm" variant="secondary" disabled={isSaving || Boolean(definition.availabilityReason) || !drafts[definition.id]} onClick={() => void saveDefinition(definition.id, { config: values })}>
                            {isSaving ? <><Icon icon="fa6-solid:spinner" className="mr-2 animate-spin" />Saving…</> : "Save settings"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
