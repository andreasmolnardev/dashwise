"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import useAuth from "@/context/useAuth";
import {
  createSdkIntegrationInstanceAction,
  deleteSdkIntegrationInstanceAction,
  getSdkIntegrationCatalogAction,
  getSdkIntegrationInstanceStatusAction,
  getSdkIntegrationInstancesAction,
  testSdkIntegrationConnectionAction,
  updateSdkIntegrationInstanceAction,
  type SdkIntegrationCatalogEntry,
  type SdkIntegrationInstance,
  type SdkIntegrationRuntimeStatus,
} from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AppIcon from "@dashwise/app-icon";

type ConfigField = Record<string, unknown> & { type?: string; label?: string; description?: string; required?: boolean };

export default function SdkIntegrationsManager({ view }: { view: "installed" | "catalog" }) {
  const { withAuth } = useAuth();
  const [catalog, setCatalog] = useState<SdkIntegrationCatalogEntry[]>([]);
  const [instances, setInstances] = useState<SdkIntegrationInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, SdkIntegrationRuntimeStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SdkIntegrationInstance | null>(null);
  const [installing, setInstalling] = useState<SdkIntegrationCatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (view === "catalog") {
        setCatalog(await withAuth(getSdkIntegrationCatalogAction));
        return;
      }

      const nextInstances = await withAuth(getSdkIntegrationInstancesAction);
      setInstances(nextInstances);
      const nextStatuses = await Promise.all(nextInstances.map(async (instance) => {
        const status = await withAuth((auth) => getSdkIntegrationInstanceStatusAction(auth, instance.id)).catch(() => null);
        return [instance.id, status] as const;
      }));
      setRuntimeStatuses(Object.fromEntries(nextStatuses.filter((entry): entry is readonly [string, SdkIntegrationRuntimeStatus] => entry[1] !== null)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SDK integrations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [view, withAuth]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedDefinition = useMemo(
    () => catalog.find((entry) => entry.id === (editing?.source ?? installing?.id)) ?? null,
    [catalog, editing, installing],
  );

  const openInstall = (definition: SdkIntegrationCatalogEntry) => {
    setEditing(null);
    setInstalling(definition);
    setName(definition.name);
    setDraft({});
    setError(null);
  };

  const openEdit = (instance: SdkIntegrationInstance) => {
    setInstalling(null);
    setEditing(instance);
    setName(instance.name);
    setDraft({ ...instance.config });
    setError(null);
  };

  const closeDialog = (open: boolean) => {
    if (open || saving) return;
    setEditing(null);
    setInstalling(null);
  };

  const save = async () => {
    if (!selectedDefinition) return;
    const config: Record<string, unknown> = {};
    for (const [key, rawField] of Object.entries(selectedDefinition.config)) {
      const field = rawField as ConfigField;
      const value = draft[key];
      if (field.type === "secret" && editing && (value === undefined || value === "")) continue;
      if (value === undefined || value === "") continue;
      config[key] = field.type === "number" ? Number(value) : value;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await withAuth((auth) => updateSdkIntegrationInstanceAction(auth, editing.id, { name: name.trim(), config }));
      } else {
        await withAuth((auth) => createSdkIntegrationInstanceAction(auth, { source: selectedDefinition.id, name: name.trim(), config }));
      }
      setEditing(null);
      setInstalling(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (instance: SdkIntegrationInstance) => {
    if (!window.confirm(`Remove ${instance.name}? Its integration data and Shortcuts will be deleted.`)) return;
    setError(null);
    try {
      await withAuth((auth) => deleteSdkIntegrationInstanceAction(auth, instance.id));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration could not be removed.");
    }
  };

  const toggleEnabled = async (instance: SdkIntegrationInstance) => {
    setTogglingId(instance.id);
    setError(null);
    try {
      await withAuth((auth) => updateSdkIntegrationInstanceAction(auth, instance.id, { enabled: !instance.enabled }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration state could not be updated.");
    } finally {
      setTogglingId(null);
    }
  };

  const testConnection = async (instance: SdkIntegrationInstance) => {
    setTestingId(instance.id);
    setError(null);
    try {
      const result = await withAuth((auth) => testSdkIntegrationConnectionAction(auth, instance.id));
      setRuntimeStatuses((current) => ({
        ...current,
        [instance.id]: !result.success && !result.status.message
          ? { ...result.status, message: `Could not connect ${instance.name}.` }
          : result.status,
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The connection test failed.";
      setRuntimeStatuses((current) => ({
        ...current,
        [instance.id]: {
          state: "error",
          updatedAt: new Date().toISOString(),
          message: `${instance.name}: ${message}`,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <>
      {view === "installed" && (loading ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : instances.map((instance) => {
        const status = runtimeStatuses[instance.id];
        const iconSource = instance.source === "homeassistant" ? "mdi:home-assistant" : undefined;
        return (
          <div
            key={instance.id}
            className="grid grid-cols-[auto_1fr] items-center w-full gap-1 rounded-2xl border p-4 text-left transition frosted group relative"
          >
            <AppIcon source={iconSource} fallbackSource="fa6-solid:puzzle" alt={instance.name} className="h-8 w-8 text-[1.5rem] row-span-2" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold group-hover:text-primary">{instance.name}</p>
                <Badge variant="outline" className="border-white/20 bg-white/5 text-[0.7rem] text-white/80">
                  SDK integration
                </Badge>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${instance.name}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!instance.enabled || testingId === instance.id} onClick={() => void testConnection(instance)}>
                    {testingId === instance.id ? "Testing connection…" : "Test connection"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={togglingId === instance.id} onClick={() => void toggleEnabled(instance)}>
                    {instance.enabled ? "Disable" : "Enable"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openEdit(instance)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => void remove(instance)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className={`text-xs ${status?.state === "error" ? "text-destructive" : "text-white/80"}`}>
              {instance.enabled ? "Enabled" : "Disabled"}
              {status ? ` · ${status.state}` : ""}
            </p>
            {status?.state === "error" && (
              <details className="col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium text-destructive">
                  Show more error details for {instance.name}
                </summary>
                <p className="mt-2 break-words text-white/80">
                  {instance.name}: {status.message ?? "The integration failed to start."}
                </p>
              </details>
            )}
          </div>
        );
      }))}

      {view === "catalog" && (
        <>
          {error && <p role="alert" className="col-span-full rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-white">{error}</p>}
          {loading && catalog.length === 0 && (
            <div className="col-span-full flex h-16 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {catalog.map((definition) => (
            <button
              key={definition.id}
              type="button"
              className="frosted group flex min-w-0 flex-row items-start gap-2 rounded-2xl border p-2 text-left transition hover:border-primary/60 hover:bg-primary/5"
              onClick={() => openInstall(definition)}
            >
              <span className="flex h-7 w-10 shrink-0 self-center items-center justify-center text-white/70 transition group-hover:text-primary">
                <AppIcon
                  source={definition.id === "homeassistant" ? "mdi:home-assistant" : undefined}
                  fallbackSource="fa6-solid:puzzle"
                  alt={definition.name}
                  className="h-7 w-10 text-[1.5rem] text-white"
                  imageClassName="object-contain"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold transition group-hover:text-primary">{definition.name}</span>
                  <Badge variant="outline" className="border-white/20 bg-white/5 text-[0.7rem] text-white/80">
                    SDK integration
                  </Badge>
                </span>
                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                  {definition.description ?? `Version ${definition.version}`}
                </span>
              </span>
            </button>
          ))}
        </>
      )}

      <Dialog open={!!editing || !!installing} onOpenChange={closeDialog}>
        <DialogContent className="frosted max-h-[85vh] overflow-y-auto text-foreground">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${selectedDefinition?.name ?? "integration"}` : `Install ${selectedDefinition?.name ?? "integration"}`}</DialogTitle>
            <DialogDescription>Connection details are stored securely for this account.</DialogDescription>
          </DialogHeader>
          {selectedDefinition && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="sdk-instance-name">Name</Label>
                <Input id="sdk-instance-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
              </div>
              {Object.entries(selectedDefinition.config).map(([key, rawField]) => {
                const field = rawField as ConfigField;
                const label = field.label ?? key;
                const value = draft[key];
                const common = { id: `sdk-config-${key}`, required: field.required === true && !(editing && field.type === "secret"), placeholder: String(field.placeholder ?? "") };
                return (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={common.id}>{label}{field.required ? " *" : ""}</Label>
                    {field.type === "boolean" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input id={common.id} type="checkbox" checked={typeof value === "boolean" ? value : Boolean(field.default)} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} />
                        Enabled
                      </label>
                    ) : field.type === "select" ? (
                      <select id={common.id} value={String(value ?? field.default ?? "")} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">Select…</option>
                        {(Array.isArray(field.options) ? field.options : []).map((rawOption) => {
                          const option = rawOption as { label?: string; value?: unknown };
                          return <option key={String(option.value)} value={String(option.value)}>{option.label ?? String(option.value)}</option>;
                        })}
                      </select>
                    ) : (
                      <Input
                        {...common}
                        type={field.type === "secret" ? "password" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
                        min={typeof field.min === "number" ? field.min : undefined}
                        max={typeof field.max === "number" ? field.max : undefined}
                        step={typeof field.step === "number" ? field.step : undefined}
                        value={String(value ?? (field.type === "secret" && editing ? "" : field.default ?? ""))}
                        placeholder={field.type === "secret" && editing && editing.configuredSecrets.includes(key) ? "Saved; leave blank to keep it" : common.placeholder}
                        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                      />
                    )}
                    {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                  </div>
                );
              })}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => closeDialog(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !selectedDefinition}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editing ? "Save changes" : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
