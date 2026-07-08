import type { ChangeEvent } from "react";

export type WidgetPropertiesFormProps = {
  idPrefix?: string;
  schema?: Record<string, any>;
  value?: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  onError?: (message: string | null) => void;
  error?: string | null;
  emptyMessage?: string;
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

export default function WidgetPropertiesForm({
  idPrefix = "widget-properties",
  schema = {},
  value = {},
  onChange,
  onError,
  error,
  emptyMessage = "No configurable properties for this widget.",
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
        const type = selectSchema ? "select" : getValueType(schemaValue ?? currentValue);
        const inputId = `${idPrefix}-${key}`;
        const selectOptions = selectSchema ? getSelectOptions(selectSchema) : [];
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
            <p className="text-xs text-white/50">Default: {formatDefault(schemaValue)}</p>

            {selectSchema ? (
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
