"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type {
  ViewDefinition,
  ViewFilter,
  ViewFilterOperator,
  ViewRecord,
  ViewResourceQuery,
  ViewWriteInput,
} from "@/lib/viewsApi";

const FILTER_OPERATORS: ViewFilterOperator[] = [
  "eq", "neq", "gt", "gte", "lt", "lte", "contains", "containsAny", "exists",
];

type FilterDraft = { field: string; operator: ViewFilterOperator; value: string };

type ViewForm = {
  name: string;
  typesCsv: string;
  provider: string;
  providerInstanceId: string;
  capabilitiesCsv: string;
  search: string;
  orderBy: "updatedAt" | "createdAt" | "type" | "publishedAt";
  limit: string;
  offset: string;
  filters: FilterDraft[];
  presentationJson: string;
};

function emptyForm(): ViewForm {
  return {
    name: "",
    typesCsv: "",
    provider: "",
    providerInstanceId: "",
    capabilitiesCsv: "",
    search: "",
    orderBy: "updatedAt",
    limit: "",
    offset: "",
    filters: [],
    presentationJson: "",
  };
}

function csvToList(csv: string): string[] {
  return csv.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function filterListToDrafts(filters: ViewFilter[] | undefined): FilterDraft[] {
  return (filters ?? []).map((filter) => ({
    field: filter.field,
    operator: filter.operator,
    value: filter.operator === "exists" ? "" : typeof filter.value === "string" ? filter.value : JSON.stringify(filter.value ?? ""),
  }));
}

function viewToForm(view: ViewRecord | null | undefined): ViewForm {
  if (!view) return emptyForm();
  const query = view.definition?.query;
  return {
    name: view.name,
    typesCsv: (query?.types ?? []).join(", "),
    provider: query?.provider ?? "",
    providerInstanceId: query?.providerInstanceId ?? "",
    capabilitiesCsv: (query?.capabilities ?? []).join(", "),
    search: query?.search ?? "",
    orderBy: query?.orderBy ?? "updatedAt",
    limit: query?.limit ? String(query.limit) : "",
    offset: query?.offset ? String(query.offset) : "",
    filters: filterListToDrafts(query?.filters),
    presentationJson: view.definition?.presentation
      ? JSON.stringify(view.definition.presentation, null, 2)
      : "",
  };
}

type FormError = { error: string };

function isFormError(value: unknown): value is FormError {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as FormError).error === "string";
}

/** The stored query keeps optional fields unset so the server omits them. */
function formToDefinition(form: ViewForm): ViewResourceQuery | { error: string } {
  const query: Partial<ViewResourceQuery> = {};
  const types = csvToList(form.typesCsv);
  if (types.length) query.types = types;
  if (form.provider.trim()) query.provider = form.provider.trim().toLowerCase();
  if (form.providerInstanceId.trim()) query.providerInstanceId = form.providerInstanceId.trim();
  const capabilities = csvToList(form.capabilitiesCsv);
  if (capabilities.length) query.capabilities = capabilities;
  const filters: ViewFilter[] = [];
  for (const draft of form.filters) {
    if (!draft.field.trim()) continue;
    if (draft.operator === "exists") {
      filters.push({ field: draft.field.trim(), operator: draft.operator, value: true });
      continue;
    }
    if (!draft.value.trim()) return { error: `filter "${draft.field.trim()}" requires a value` };
    const raw = draft.value.trim();
    const numeric = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    filters.push({
      field: draft.field.trim(),
      operator: draft.operator,
      value: draft.operator === "containsAny"
        ? csvToList(raw)
        : draft.operator === "eq" || draft.operator === "neq"
        ? (Number.isFinite(numeric) ? numeric : raw)
        : raw,
    });
  }
  if (filters.length) query.filters = filters;
  if (form.search.trim()) query.search = form.search.trim();
  query.orderBy = form.orderBy;
  const limit = Number(form.limit);
  if (form.limit.trim() && Number.isFinite(limit) && limit > 0) query.limit = Math.floor(limit);
  const offset = Number(form.offset);
  if (form.offset.trim() && Number.isFinite(offset) && offset >= 0) query.offset = Math.floor(offset);
  return query as ViewResourceQuery;
}

function formToPresentation(form: ViewForm): Record<string, unknown> | undefined | { error: string } {
  const raw = form.presentationJson.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "presentation must be a JSON object" };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { error: "presentation must be valid JSON" };
  }
}

export default function ViewDialog({
  open,
  onOpenChange,
  view,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: ViewRecord | null;
  onSaved: (input: ViewWriteInput) => Promise<ViewRecord | void>;
}) {
  const [form, setForm] = useState<ViewForm>(() => viewToForm(view));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(viewToForm(view));
      setError(null);
    }
  }, [open, view]);

  const update = (patch: Partial<ViewForm>) => setForm((current) => ({ ...current, ...patch }));

  const updateFilter = (index: number, patch: Partial<FilterDraft>) =>
    setForm((current) => ({
      ...current,
      filters: current.filters.map((filter, filterIndex) =>
        filterIndex === index ? { ...filter, ...patch } : filter),
    }));

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("a view name is required");
      return;
    }
    const query = formToDefinition(form);
    if (isFormError(query)) {
      setError(query.error);
      return;
    }
    const presentation = formToPresentation(form);
    if (isFormError(presentation)) {
      setError(presentation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const definition: ViewDefinition = {
        query,
        ...(presentation ? { presentation } : {}),
      };
      await onSaved({ name, definition });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : "could not save the view");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="frosted bg-black/60 border-white/20 text-foreground max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{view ? "edit view" : "new view"}</DialogTitle>
          <DialogDescription className="text-white/60">
            saved views run resource queries; owner scope is applied on the server
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="view-name">name</Label>
            <Input
              id="view-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              maxLength={120}
              placeholder="weekly apt updates"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="view-types">types (comma separated)</Label>
              <Input
                id="view-types"
                value={form.typesCsv}
                onChange={(event) => update({ typesCsv: event.target.value })}
                placeholder="apt Package"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-provider">provider</Label>
              <Input
                id="view-provider"
                value={form.provider}
                onChange={(event) => update({ provider: event.target.value })}
                placeholder="apt"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-provider-instance">provider instance id</Label>
              <Input
                id="view-provider-instance"
                value={form.providerInstanceId}
                onChange={(event) => update({ providerInstanceId: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-capabilities">capabilities (comma separated)</Label>
              <Input
                id="view-capabilities"
                value={form.capabilitiesCsv}
                onChange={(event) => update({ capabilitiesCsv: event.target.value })}
                placeholder="monitoring"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="view-search">search</Label>
              <Input
                id="view-search"
                value={form.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>order by</Label>
              <Select value={form.orderBy} onValueChange={(value) => update({ orderBy: value as ViewForm["orderBy"] })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="frosted bg-black/70 text-foreground">
                  <SelectItem value="updatedAt">updatedAt</SelectItem>
                  <SelectItem value="createdAt">createdAt</SelectItem>
                  <SelectItem value="type">type</SelectItem>
                  <SelectItem value="publishedAt">publishedAt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-limit">limit</Label>
              <Input
                id="view-limit"
                inputMode="numeric"
                value={form.limit}
                onChange={(event) => update({ limit: event.target.value })}
                placeholder="50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-offset">offset</Label>
              <Input
                id="view-offset"
                inputMode="numeric"
                value={form.offset}
                onChange={(event) => update({ offset: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>filters</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((current) => ({
                  ...current,
                  filters: [...current.filters, { field: "", operator: "eq", value: "" }],
                }))}
              >
                <Plus /> filter
              </Button>
            </div>
            {form.filters.length === 0 && (
              <p className="text-xs text-white/50">
                filters require exactly one resource type and a filterable field
              </p>
            )}
            {form.filters.map((filter, index) => (
              <div key={`${index}-${filter.field}`} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                <Input
                  value={filter.field}
                  onChange={(event) => updateFilter(index, { field: event.target.value })}
                  placeholder="field"
                  className="font-mono text-xs"
                />
                <Select
                  value={filter.operator}
                  onValueChange={(value) => updateFilter(index, { operator: value as ViewFilterOperator })}
                >
                  <SelectTrigger className="w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="frosted bg-black/70 text-foreground">
                    {FILTER_OPERATORS.map((operator) => (
                      <SelectItem key={operator} value={operator}>{operator}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={filter.operator === "exists" ? "true" : filter.value}
                  disabled={filter.operator === "exists"}
                  onChange={(event) => updateFilter(index, { value: event.target.value })}
                  placeholder="value"
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="remove filter"
                  onClick={() => setForm((current) => ({
                    ...current,
                    filters: current.filters.filter((_, filterIndex) => filterIndex !== index),
                  }))}
                >
                  <Trash2 className="text-white/60" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="view-presentation">presentation (optional json object)</Label>
            <Textarea
              id="view-presentation"
              value={form.presentationJson}
              onChange={(event) => update({ presentationJson: event.target.value })}
              placeholder={"{ \"columns\": [\"name\"] }"}
              className="font-mono text-xs min-h-20"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>cancel</Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? "saving…" : view ? "save changes" : "create view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
