"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import useAuth from "@/context/useAuth";
import {
  createSdkIntegrationInstanceAction,
  deleteSdkIntegrationInstanceAction,
  getSdkIntegrationCatalogAction,
  getSdkIntegrationInstancesAction,
  updateSdkIntegrationInstanceAction,
  type SdkIntegrationCatalogEntry,
  type SdkIntegrationInstance,
} from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConfigField = Record<string, unknown> & { type?: string; label?: string; description?: string; required?: boolean };

export default function SdkIntegrationsManager() {
  const { withAuth } = useAuth();
  const [catalog, setCatalog] = useState<SdkIntegrationCatalogEntry[]>([]);
  const [instances, setInstances] = useState<SdkIntegrationInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SdkIntegrationInstance | null>(null);
  const [installing, setInstalling] = useState<SdkIntegrationCatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCatalog, nextInstances] = await Promise.all([
        withAuth(getSdkIntegrationCatalogAction),
        withAuth(getSdkIntegrationInstancesAction),
      ]);
      setCatalog(nextCatalog);
      setInstances(nextInstances);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SDK integrations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [withAuth]);

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

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">SDK integrations</h2>
          <p className="text-sm text-muted-foreground">Install built-in integrations and manage their connections.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="frosted" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
          Refresh
        </Button>
      </header>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}

      {loading ? (
        <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {catalog.map((definition) => {
            const installed = instances.filter((instance) => instance.source === definition.id);
            return (
              <Card key={definition.id} className="frosted border-white/10">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{definition.name}</h3>
                      <p className="text-xs text-muted-foreground">{definition.description ?? `Version ${definition.version}`}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => openInstall(definition)}>
                      <Plus className="mr-1.5 size-4" /> Install
                    </Button>
                  </div>
                  {installed.length > 0 && (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      {installed.map((instance) => (
                        <div key={instance.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/10 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{instance.name}</p>
                            <p className="text-xs text-muted-foreground">{instance.enabled ? "Enabled" : "Disabled"}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button type="button" size="sm" variant="ghost" aria-label={`${instance.enabled ? "Disable" : "Enable"} ${instance.name}`} onClick={() => void toggleEnabled(instance)} disabled={togglingId === instance.id}>
                              {togglingId === instance.id ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                              {instance.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${instance.name}`} onClick={() => openEdit(instance)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${instance.name}`} onClick={() => void remove(instance)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {catalog.length === 0 && <p className="text-sm text-muted-foreground">No SDK integrations are available.</p>}
        </div>
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
    </section>
  );
}
