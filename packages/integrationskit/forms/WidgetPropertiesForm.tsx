import { useEffect, useState, type ChangeEvent } from "react";

export type GlanceableSlotPosition = "left" | "right" | "top" | "down";

export type GlanceableOption = {
  value: string;
  label: string;
  exampleProps?: Record<string, any>;
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
  const record = isRecord(value) ? value : {};
  const rawSlots = isRecord(record.slots) ? record.slots : record;

  return {
    left: normalizePositionSlots(rawSlots.left),
    right: normalizePositionSlots(rawSlots.right),
    top: normalizePositionSlots(rawSlots.top),
    down: normalizePositionSlots(rawSlots.down),
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
}: {
  value: unknown;
  options: GlanceableOption[];
  positions: readonly GlanceableSlotPosition[];
  onChange: (next: Record<string, any>) => void;
  onError?: (message: string | null) => void;
}) {
  const currentValue = isRecord(value) && value.type !== "glanceables" ? value : {};
  const slots = normalizeGlanceableSlots(value);
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const positionKey = positions.join("|");

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    positions.forEach((position) => {
      slots[position].forEach((slot, index) => {
        nextDrafts[`${position}-${index}`] = JSON.stringify(slot.params, null, 2);
      });
    });
    setParamDrafts(nextDrafts);
    // The value and selected positions are the source of truth for the text drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey, value]);

  const updateSlots = (nextSlots: GlanceableSlots) => {
    onError?.(null);
    onChange({
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/55">
        Choose one or more glanceables for each row. Selected glanceables are shown together.
      </p>
      {positions.map((position) => (
        <div key={position} className="space-y-2 rounded-lg border border-white/10 bg-black/10 p-3">
          <p className="text-sm font-medium capitalize text-white">{position} row</p>
          <div className="grid gap-2 sm:grid-cols-2">
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
          </div>
          {slots[position].map((slot, index) => {
            const option = options.find((item) => item.value === slot.type);
            const draftKey = `${position}-${index}`;
            return (
              <div key={`${slot.type}-${index}`} className="space-y-1.5 rounded-md border border-white/10 bg-black/15 p-2">
                <p className="text-xs font-medium text-white/75">
                  {option?.label ?? slot.type} properties
                </p>
                <textarea
                  aria-label={`${option?.label ?? slot.type} properties`}
                  value={paramDrafts[draftKey] ?? JSON.stringify(slot.params, null, 2)}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setParamDrafts((current) => ({ ...current, [draftKey]: nextText }));
                    try {
                      const nextParams = JSON.parse(nextText);
                      if (!isRecord(nextParams)) throw new Error("Expected object");
                      updateParams(position, index, nextParams);
                    } catch {
                      onError?.("Glanceable properties must be valid JSON objects.");
                    }
                  }}
                  className="min-h-16 w-full rounded-md border border-white/15 bg-black/20 p-2 text-xs outline-none"
                  spellCheck={false}
                />
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
              <label htmlFor={inputId} className="text-sm font-medium text-white">{key}</label>
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/60">{type}</span>
            </div>
            {!isGlanceablesField && <p className="text-xs text-white/50">Default: {formatDefault(schemaValue)}</p>}

            {isGlanceablesField ? (
              <GlanceablesEditor
                value={currentValue}
                options={glanceableOptions}
                positions={glanceableSlotPositions}
                onChange={(nextValue) => updateValue(key, nextValue)}
                onError={onError}
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
