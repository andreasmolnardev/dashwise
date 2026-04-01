
function toText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getPreviewText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const preferred =
    record.fallback ?? record.value ?? record.primary ?? record.title ?? record.label ?? record.text;

  if (preferred !== undefined && preferred !== null) {
    return toText(preferred);
  }

  return toText(value);
}

function getImageUrl(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const direct = record.file ?? record.iconUrl ?? record.url;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  if (typeof record.value === "string") {
    return record.value;
  }

  return "";
}

export default function IconDetailsCard(
  properties: Record<string, unknown>,
  className?: string,
) {
  const icon = getImageUrl(properties.icon) || getImageUrl(properties.image) || getImageUrl(properties.leftIcon);
  const primary = getPreviewText(properties.primary) || "Weather";
  const secondary = getPreviewText(properties.secondary);

  return (
    <div className={`frosted rounded-lg p-3 ${className || ""}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-2 items-center gap-x-3 gap-y-1">
        <div className="row-span-2 flex h-12 w-12 items-center justify-center rounded-lg bg-black/10">
          {icon ? (
            <img src={icon} className="h-9 w-9 object-contain" alt="" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{primary}</p>
        </div>
        <div className="min-w-0">
          {secondary ? (
            <p className="truncate text-sm text-white/75 leading-tight">{secondary}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}