import { useEffect, useState, type ChangeEvent } from "react";
import GlanceableComponent from "../Glanceable";

export type GlanceableOption = {
  value: string;
  label: string;
  exampleProps?: Record<string, any>;
  appName?: string;
  integrationName?: string;
  integrationDisplayName?: string;
};

export type WidgetPropertiesFormProps = {
  idPrefix?: string;
  schema?: Record<string, any>;
  value?: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  onError?: (message: string | null) => void;
  error?: string | null;
  emptyMessage?: string;
  glanceableOptions?: GlanceableOption[];
  onAddGlanceable?: (side: "left" | "right") => void;
};

type SelectSchema = {
  type: "select";
  default?: unknown;
  options?: Array<string | { value: string; label?: string }>;
};

function getValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null || value === undefined) return "string";
  return typeof value;
}

function formatDefault(value: unknown) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value ? `"${value}"` : "empty string";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isSelectSchema(value: unknown): value is SelectSchema {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, any>).type === "select";
}

function getSelectOptions(schemaValue: SelectSchema) {
  return (schemaValue.options ?? [])
    .map((option) => {
      if (typeof option === "string") {
        return { value: option, label: option };
      }

      return {
        value: option.value,
        label: option.label ?? option.value,
      };
    })
    .filter((option) => Boolean(option.value));
}

type GlanceableSlot = {
  type: string;
  params: Record<string, any>;
};

type GlanceableSlots = {
  left: GlanceableSlot[];
  right: GlanceableSlot[];
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeGlanceableSlot(value: unknown): GlanceableSlot | null {
  if (typeof value === "string" && value) {
    return { type: value, params: {} };
  }

  if (!isRecord(value) || typeof value.type !== "string" || !value.type) {
    return null;
  }

  return {
    type: value.type,
    params: isRecord(value.params) ? value.params : {},
  };
}

function normalizeGlanceableSlots(value: unknown): GlanceableSlots {
  const record = isRecord(value) ? value : {};
  const rawSlots = isRecord(record.slots) ? record.slots : null;

  if (rawSlots) {
    return {
      left: Array.isArray(rawSlots.left)
        ? rawSlots.left.map(normalizeGlanceableSlot).filter((item): item is GlanceableSlot => Boolean(item))
        : [],
      right: Array.isArray(rawSlots.right)
        ? rawSlots.right.map(normalizeGlanceableSlot).filter((item): item is GlanceableSlot => Boolean(item))
        : [],
    };
  }

  const legacySides = (['left', 'right'] as const).map((side) => normalizeGlanceableSlot(record[side]));
  if (legacySides.some(Boolean)) {
    return {
      left: legacySides[0] ? [legacySides[0]] : [],
      right: legacySides[1] ? [legacySides[1]] : [],
    };
  }

  return {
    left: Object.entries(record)
      .filter(([key]) => key !== "intervals")
      .map(([, item]) => normalizeGlanceableSlot(item))
      .filter((item): item is GlanceableSlot => Boolean(item))
      .slice(0, 1),
    right: Object.entries(record)
      .filter(([key]) => key !== "intervals")
      .map(([, item]) => normalizeGlanceableSlot(item))
      .filter((item): item is GlanceableSlot => Boolean(item))
      .slice(1, 2),
  };
}

function GlanceablesEditor({
  value,
  options,
  onChange,
  onError,
  idPrefix,
  onAddGlanceable,
}: {
  value: unknown;
  options: GlanceableOption[];
  onChange: (next: Record<string, any>) => void;
  onError?: (message: string | null) => void;
  idPrefix: string;
  onAddGlanceable?: (side: "left" | "right") => void;
}) {
  const slots = normalizeGlanceableSlots(value);
  const currentValue = isRecord(value) && value.type !== "glanceables" ? value : {};
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [newTypes, setNewTypes] = useState<Record<"left" | "right", string>>({ left: "", right: "" });

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const side of ["left", "right"] as const) {
      slots[side].forEach((slot, index) => {
        nextDrafts[`${side}-${index}`] = JSON.stringify(slot.params, null, 2);
      });
    }
    setParamDrafts(nextDrafts);
  }, [value]);

  const updateSlots = (nextSlots: GlanceableSlots) => {
    onError?.(null);
    onChange({ ...currentValue, slots: nextSlots });
  };

  const addSlot = (side: "left" | "right") => {
    if (onAddGlanceable) {
      onAddGlanceable(side);
      return;
    }

    const option = options.find((item) => item.value === newTypes[side]) ?? options[0];
    if (!option) return;
    updateSlots({
      ...slots,
      [side]: [...slots[side], { type: option.value, params: option.exampleProps ?? {} }],
    });
  };

  const updateSlot = (side: "left" | "right", index: number, patch: Partial<GlanceableSlot>) => {
    updateSlots({
      ...slots,
      [side]: slots[side].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    });
  };

  const removeSlot = (side: "left" | "right", index: number) => {
    updateSlots({
      ...slots,
      [side]: slots[side].filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const moveSlot = (side: "left" | "right", index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= slots[side].length) return;

    const nextSide = [...slots[side]];
    [nextSide[index], nextSide[nextIndex]] = [nextSide[nextIndex], nextSide[index]];
    updateSlots({ ...slots, [side]: nextSide });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/50">Add one or more glanceables to either side of this clock.</p>
      {(["left", "right"] as const).map((side) => (
        <div key={side} className="space-y-2 rounded-md border border-white/10 bg-black/10 p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium capitalize text-white">{side} side</p>
            <div className="flex items-center gap-1.5">
              {!onAddGlanceable && (
                <select
                  aria-label={`Choose ${side} glanceable to add`}
                  value={newTypes[side] || options[0]?.value || ""}
                  onChange={(event) => setNewTypes((current) => ({ ...current, [side]: event.target.value }))}
                  className="max-w-32 rounded-md border border-white/15 bg-black/20 px-2 py-1 text-xs outline-none"
                >
                  {options.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => addSlot(side)}
                className="rounded-full border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                {onAddGlanceable ? "Add a glanceable" : "Add"}
              </button>
            </div>
          </div>
          {slots[side].length === 0 ? (
            <p className="text-xs text-white/45">No glanceables added.</p>
          ) : (
            <div className="space-y-2">
              {slots[side].map((slot, index) => {
                const option = options.find((item) => item.value === slot.type);
                const inputId = `${idPrefix}-${side}-${index}`;
                return (
                  <div key={`${side}-${index}`} className="space-y-2 rounded-md border border-white/10 bg-black/15 p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-xs text-white/45">{index + 1}</span>
                      <div className="min-w-0 flex-1 overflow-hidden rounded bg-black/15 px-2 py-1 text-center">
                        <GlanceableComponent
                          type={slot.type}
                          params={{ ...(option?.exampleProps ?? {}), ...slot.params }}
                          isPreview
                          className="truncate text-xs"
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveSlot(side, index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${option?.label ?? slot.type} up`}
                          className="rounded border border-white/15 px-1.5 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSlot(side, index, 1)}
                          disabled={index === slots[side].length - 1}
                          aria-label={`Move ${option?.label ?? slot.type} down`}
                          className="rounded border border-white/15 px-1.5 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          Down
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSlot(side, index)}
                        className="rounded-full border border-red-400/30 px-2 py-1 text-xs text-red-200 hover:bg-red-500/15"
                      >
                        Remove
                      </button>
                    </div>
                    <select
                      id={inputId}
                      value={slot.type}
                      onChange={(event) => {
                        const nextOption = options.find((item) => item.value === event.target.value);
                        updateSlot(side, index, {
                          type: event.target.value,
                          params: nextOption?.exampleProps ?? {},
                        });
                      }}
                      className="w-full rounded-md border border-white/15 bg-black/20 px-2 py-1.5 text-sm outline-none"
                    >
                      {options.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <textarea
                      aria-label={`${option?.label ?? slot.type} properties`}
                      value={paramDrafts[`${side}-${index}`] ?? JSON.stringify(slot.params, null, 2)}
                      onChange={(event) => {
                        const draftKey = `${side}-${index}`;
                        setParamDrafts((current) => ({ ...current, [draftKey]: event.target.value }));
                        try {
                          const nextParams = JSON.parse(event.target.value);
                          if (!isRecord(nextParams)) throw new Error("Expected object");
                          updateSlot(side, index, { params: nextParams });
                        } catch {
                          onError?.("Glanceable properties must be valid JSON objects.");
                        }
                      }}
                      className="min-h-20 w-full rounded-md border border-white/15 bg-black/20 p-2 text-xs outline-none"
                      spellCheck={false}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function WidgetPropertiesForm({
  idPrefix = "widget-properties",
  schema = {},
  value = {},
  onChange,
  onError,
  error,
  emptyMessage = "No configurable properties for this widget.",
  glanceableOptions = [],
  onAddGlanceable,
}: WidgetPropertiesFormProps) {
  const keys = Array.from(new Set([...Object.keys(schema), ...Object.keys(value)]));

  if (keys.length === 0) {
    return <p className="text-sm text-white/60">{emptyMessage}</p>;
  }

  const updateValue = (key: string, nextValue: unknown) => {
    onError?.(null);
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const schemaValue = schema[key];
        const hasStoredValue = key in value;
        const currentValue = hasStoredValue ? value[key] : schemaValue;
        const selectSchema = isSelectSchema(schemaValue) ? schemaValue : null;
        const inputId = `${idPrefix}-${key}`;
        const selectOptions = selectSchema ? getSelectOptions(selectSchema) : [];
        const isGlanceablesField = key === "glanceables" && glanceableOptions.length > 0;
        const type = isGlanceablesField ? "glanceables" : selectSchema ? "select" : getValueType(schemaValue ?? currentValue);
        const selectValue = hasStoredValue && value[key] != null && value[key] !== ""
          ? String(value[key])
          : ""
        const resolvedSelectValue = selectValue || String(selectSchema?.default ?? selectOptions[0]?.value ?? "")

        return (
          <div key={key} className="space-y-1.5 rounded-lg border border-white/10 bg-black/15 p-3">
            <div className="flex items-start justify-between gap-3">
              <label htmlFor={inputId} className="text-sm font-medium text-white">{key === "glanceables" ? "Glanceables" : key}</label>
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/60">{type}</span>
            </div>
            <p className="text-xs text-white/50">
              {isGlanceablesField ? "Configure glanceables for this clock." : `Default: ${formatDefault(schemaValue)}`}
            </p>

            {isGlanceablesField ? (
              <GlanceablesEditor
                value={currentValue}
                options={glanceableOptions}
                onChange={(nextValue) => updateValue(key, nextValue)}
                onError={onError}
                idPrefix={inputId}
                onAddGlanceable={onAddGlanceable}
              />
            ) : selectSchema ? (
              <select
                id={inputId}
                value={resolvedSelectValue}
                onChange={(event) => updateValue(key, event.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
              >
                {selectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : type === "boolean" ? (
              <input
                id={inputId}
                type="checkbox"
                checked={Boolean(currentValue)}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(key, event.target.checked)}
                className="h-4 w-4 accent-white"
              />
            ) : type === "number" ? (
              <input
                id={inputId}
                type="number"
                value={typeof currentValue === "number" ? currentValue : ""}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(key, event.target.value === "" ? null : Number(event.target.value))}
                className="w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
              />
            ) : type === "string" ? (
              <input
                id={inputId}
                type="text"
                value={currentValue == null ? "" : String(currentValue)}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(key, event.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none"
              />
            ) : (
              <textarea
                id={inputId}
                value={JSON.stringify(currentValue ?? schemaValue ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    updateValue(key, JSON.parse(event.target.value));
                  } catch {
                    onError?.("Properties must be valid JSON.");
                  }
                }}
                className="min-h-24 w-full rounded-md border border-white/15 bg-black/20 p-3 text-sm outline-none"
                spellCheck={false}
              />
            )}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
