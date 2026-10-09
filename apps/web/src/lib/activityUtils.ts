export function safeActivityTarget(target?: string) {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\") || hasControlCharacters(target)) return null;
  try {
    const parsed = new URL(target, "https://dashwise.invalid");
    return parsed.origin === "https://dashwise.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function formatActivityTime(value: string, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const [unit, size] = units.find(([, unitSize]) => Math.abs(seconds) >= unitSize) ?? ["second", 1];
  return formatter.format(Math.round(seconds / size), unit);
}
