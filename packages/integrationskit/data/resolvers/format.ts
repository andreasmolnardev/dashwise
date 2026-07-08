export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function humanBytes(value: any) {
	const bytes = Number(value);
	if (!Number.isFinite(bytes)) return value === undefined || value === null ? "" : String(value);
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let next = Math.abs(bytes);
	let unit = 0;

	while (next >= 1024 && unit < units.length - 1) {
		next /= 1024;
		unit += 1;
	}

	const sign = bytes < 0 ? "-" : "";
	const rounded = next >= 10 ? Math.round(next) : Math.round(next * 10) / 10;
	return `${sign}${rounded} ${units[unit]}`;
}
