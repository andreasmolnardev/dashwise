import { useState, type ChangeEvent } from "react";
import AppIcon from "@dashwise/app-icon";

export type GlanceableSlotPosition = "left" | "right" | "top" | "down" | "list";

export type GlanceableOption = {
  value: string;
  label: string;
  exampleProps?: Record<string, any>;
  properties?: Record<string, any>;
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
  glanceableSlotPositions?: readonly GlanceableSlotPosition[];
  onEditGlanceable?: (index: number) => void;
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

type GlanceableSlots = Record<GlanceableSlotPosition, GlanceableSlot[]>;

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeGlanceableSlot(value: unknown): GlanceableSlot | null {
  if (typeof value === "string" && value.trim()) {
    return { type: value.trim(), params: {} };
  }

  if (!isRecord(value) || typeof value.type !== "string" || !value.type.trim()) {
    return null;
  }

  return {
    type: value.type.trim(),
    params: isRecord(value.params) ? value.params : {},
  };
}

function normalizeGlanceableSlots(
  value: unknown,
): GlanceableSlots {
  if (Array.isArray(value)) {
    return {
      left: [],
      right: [],
      top: [],
      down: [],
      list: normalizePositionSlots(value),
    };
  }

  const record = isRecord(value) ? value : {};
  const rawSlots = isRecord(record.slots) ? record.slots : record;
  const legacyList = ["top", "down", "left", "right"].flatMap((position) =>
    normalizePositionSlots(rawSlots[position]),
  );

  return {
    left: normalizePositionSlots(rawSlots.left),
    right: normalizePositionSlots(rawSlots.right),
    top: normalizePositionSlots(rawSlots.top),
    down: normalizePositionSlots(rawSlots.down),
    list: normalizePositionSlots(rawSlots.list).length > 0
      ? normalizePositionSlots(rawSlots.list)
      : legacyList,
  };

  function normalizePositionSlots(rawValue: unknown) {
    const values = Array.isArray(rawValue)
      ? rawValue
      : rawValue === undefined
        ? []
        : [rawValue];
    return values
      .map(normalizeGlanceableSlot)
      .filter((item): item is GlanceableSlot => Boolean(item));
  }
}

function GlanceablesEditor({
  value,
  options,
  positions,
  onChange,
  onError,
  onEditGlanceable,
}: {
  value: unknown;
  options: GlanceableOption[];
  positions: readonly GlanceableSlotPosition[];
  onChange: (next: unknown) => void;
  onError?: (message: string | null) => void;
  onEditGlanceable?: (index: number) => void;
}) {
  const currentValue = isRecord(value) && value.type !== "glanceables" ? value : {};
  const slots = normalizeGlanceableSlots(value);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [draggedSlot, setDraggedSlot] = useState<number | null>(null);
  const isList = positions.length === 1 && positions[0] === "list";

  const updateSlots = (nextSlots: GlanceableSlots) => {
    onError?.(null);
    onChange(isList
      ? nextSlots.list
      : {
        ...currentValue,
        slots: Object.fromEntries(
          positions.map((position) => [position, nextSlots[position]]),
        ),
      });
  };

  const toggleOption = (position: GlanceableSlotPosition, option: GlanceableOption) => {
    const current = slots[position];
    const existingIndex = current.findIndex((slot) => slot.type === option.value);
    const next = existingIndex === -1
      ? [...current, { type: option.value, params: option.exampleProps ?? {} }]
      : current.filter((_, index) => index !== existingIndex);

    updateSlots({ ...slots, [position]: next });
  };

  const addOption = (position: GlanceableSlotPosition, option: GlanceableOption) => {
    updateSlots({
      ...slots,
      [position]: [...slots[position], { type: option.value, params: option.exampleProps ?? {} }],
    });
  };

  const updateParams = (
    position: GlanceableSlotPosition,
    index: number,
    params: Record<string, any>,
  ) => {
    updateSlots({
      ...slots,
      [position]: slots[position].map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, params } : slot,
      ),
    });
  };

  const removeSlot = (position: GlanceableSlotPosition, index: number) => {
    updateSlots({
      ...slots,
      [position]: slots[position].filter((_, slotIndex) => slotIndex !== index),
    });
    setEditingSlot(null);
  };

  const moveListSlot = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const next = [...slots.list];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    updateSlots({ ...slots, list: next });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/55">
        {!isList && "Choose one or more glanceables for each row. Selected glanceables are shown together."}
      </p>
      {positions.map((position) => (
        <div key={position} className={isList ? "space-y-0" : "space-y-2 rounded-lg border border-white/10 bg-black/10 p-3"}>
          <div className={isList ? "flex items-center justify-between gap-3 pb-2" : "flex items-center justify-between gap-3"}>
            <p className={isList ? "text-lg font-semibold text-white" : "text-sm font-medium capitalize text-white"}>
              {position === "list" ? "Glanceables" : `${position} row`}
            </p>
            {isList ? (
              <button
                type="button"
                aria-label="Add glanceable"
                onClick={() => {
                  const option = options.find((item) => item.value === "date") ?? {
                    value: "date",
                    label: "Date",
                  };
                  addOption(position, option);
                }}
              >
                <AppIcon source="fa6-solid:plus" alt="" size={18} />
              </button>
            ) : null}
          </div>
          {!isList && <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option) => {
              const selected = slots[position].some((slot) => slot.type === option.value);
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
                    selected
                      ? "border-primary/70 bg-primary/15 text-white"
                      : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleOption(position, option)}
                    className="h-4 w-4 accent-white"
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                </label>
              );
            })}
          </div>}
          {slots[position].map((slot, index) => {
            const option = options.find((item) => item.value === slot.type);
            const draftKey = `${position}-${index}`;
            const isEditing = editingSlot === draftKey;
            return (
              <div
                key={`${slot.type}-${index}`}
                draggable={isList}
                onDragStart={() => isList && setDraggedSlot(index)}
                onDragOver={(event) => isList && event.preventDefault()}
                onDrop={() => {
                  if (isList && draggedSlot !== null) moveListSlot(draggedSlot, index);
                  setDraggedSlot(null);
                }}
                className={isList ? "py-1" : "rounded-md border border-white/10 bg-black/15 p-2"}
              >
                <div className="flex items-center gap-2">
                  {isList && (
                    <span className="cursor-grab text-white/50" aria-label="Drag to reorder">
                      <AppIcon source="fa6-solid:grip-lines" alt="" size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-lg text-white/90">{option?.label ?? slot.type}</span>
                  {isList && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Edit ${option?.label ?? slot.type}`}
                        onClick={() => onEditGlanceable
                          ? onEditGlanceable(index)
                          : setEditingSlot(isEditing ? null : draftKey)}
                        className="text-white/60 hover:text-white"
                      >
                        <AppIcon source="fa6-solid:pen" alt="" size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${option?.label ?? slot.type}`}
                        onClick={() => removeSlot(position, index)}
                        className="text-white/60 hover:text-white"
                      >
                        <AppIcon source="fa6-solid:xmark" alt="" size={16} />
                      </button>
                    </div>
                  )}
                  {!isList && (
                    <button
                      type="button"
                      aria-label={`Remove ${option?.label ?? slot.type}`}
                      onClick={() => removeSlot(position, index)}
                      className="text-white/60 hover:text-white"
                    >
                      x
                    </button>
                  )}
                </div>
                {(!isList || isEditing) && (
                  <div className={isList ? "mt-3 space-y-3 rounded-lg bg-black/10 p-3" : "mt-2"}>
                    <WidgetPropertiesForm
                      idPrefix={`glanceable-${position}-${index}`}
                      schema={option?.properties ?? {}}
                      value={slot.params}
                      onChange={(nextParams) => updateParams(position, index, nextParams)}
                      onError={onError}
                      emptyMessage="No configurable properties for this glanceable."
                    />
                    {isList && (
                      <button
                        type="button"
                        onClick={() => removeSlot(position, index)}
                        className="text-xs text-white/60 hover:text-white"
                      >
                        Remove glanceable
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
  glanceableSlotPositions = ["left", "right"],
  onEditGlanceable,
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
        const isGlanceablesField = key === "glanceables";
        const type = isGlanceablesField ? "glanceables" : selectSchema ? "select" : getValueType(schemaValue ?? currentValue);
        const selectValue = hasStoredValue && value[key] != null && value[key] !== ""
          ? String(value[key])
          : ""
        const resolvedSelectValue = selectValue || String(selectSchema?.default ?? selectOptions[0]?.value ?? "")

        return (
          <div key={key} className={isGlanceablesField ? "space-y-1.5" : "space-y-1.5 rounded-lg border border-white/10 bg-black/15 p-3"}>
            {!isGlanceablesField && (
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={inputId} className="text-sm font-medium text-white">{key}</label>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/60">{type}</span>
              </div>
            )}
            {!isGlanceablesField && <p className="text-xs text-white/50">Default: {formatDefault(schemaValue)}</p>}

            {isGlanceablesField ? (
              <GlanceablesEditor
                value={currentValue}
                options={glanceableOptions}
                positions={glanceableSlotPositions}
                onChange={(nextValue) => updateValue(key, nextValue)}
                onError={onError}
                onEditGlanceable={onEditGlanceable}
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
