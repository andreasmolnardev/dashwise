"use client";

import { useEffect, useMemo, useState } from "react";
import useAuth from "@/context/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runSdkIntegrationAction } from "@/lib/apiClient";

export type SdkShortcutActionDefinition = {
  id: string;
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, {
      type?: string;
      title?: string;
      description?: string;
      default?: unknown;
      enum?: unknown[];
    }>;
    required?: string[];
  };
};

export type SdkShortcutResource = {
  instanceId: string;
  collectionId: string;
  resourceId: string;
};

export default function SdkShortcutActionDialog({
  open,
  onOpenChange,
  resource,
  action,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: SdkShortcutResource | null;
  action: SdkShortcutActionDefinition | null;
  onComplete?: () => void | Promise<void>;
}) {
  const { withAuth } = useAuth();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fields = useMemo(() => Object.entries(action?.inputSchema?.properties ?? {}), [action]);
  const required = new Set(action?.inputSchema?.required ?? []);

  useEffect(() => {
    if (!open || !action) return;
    setValues(Object.fromEntries(fields.map(([key, field]) => [
      key,
      field.type === "boolean" ? Boolean(field.default) : field.default == null ? "" : String(field.default),
    ])));
    setError(null);
  }, [action, open]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resource || !action) return;

    const input: Record<string, unknown> = {};
    try {
      for (const [key, field] of fields) {
        const value = values[key];
        if (value === "" || value === undefined) continue;
        if (field.type === "number" || field.type === "integer") {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new Error(`${field.title ?? key} must be a number.`);
          input[key] = number;
        } else if (field.type === "boolean") {
          input[key] = Boolean(value);
        } else if (field.type === "object" || field.type === "array") {
          input[key] = JSON.parse(String(value));
        } else {
          input[key] = value;
        }
      }

      setSubmitting(true);
      setError(null);
      await withAuth((auth) => runSdkIntegrationAction(auth, resource.instanceId, action.id, {
        collectionId: resource.collectionId,
        resourceId: resource.resourceId,
        input,
      }));
      await onComplete?.();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The integration action failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{action?.name ?? "Run integration action"}</DialogTitle>
          {action?.description && <p className="text-sm text-muted-foreground">{action.description}</p>}
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {fields.map(([key, field]) => {
            const id = `sdk-action-${action?.id}-${key}`;
            const label = field.title ?? key;
            return (
              <div key={key} className="space-y-2">
                <Label htmlFor={id}>{label}{required.has(key) ? " *" : ""}</Label>
                {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                {Array.isArray(field.enum) ? (
                  <select
                    id={id}
                    required={required.has(key)}
                    value={String(values[key] ?? "")}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select…</option>
                    {field.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                  </select>
                ) : field.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input id={id} type="checkbox" checked={Boolean(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} />
                    {label}
                  </label>
                ) : field.type === "object" || field.type === "array" ? (
                  <textarea
                    id={id}
                    required={required.has(key)}
                    value={String(values[key] ?? "")}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={field.type === "array" ? "[]" : "{}"}
                    className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                  />
                ) : (
                  <Input
                    id={id}
                    required={required.has(key)}
                    type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                    value={String(values[key] ?? "")}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                  />
                )}
              </div>
            );
          })}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !resource || !action}>{submitting ? "Running…" : "Run action"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
