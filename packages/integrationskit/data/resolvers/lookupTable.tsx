export default function getLookupTableValue(table: any, key: any, field?: string): any {
	if (table === undefined || table === null) return undefined;

	let entry: any = undefined;

	if (Array.isArray(table)) {
		const idx = typeof key === "number" ? key : Number(key);
		if (Number.isFinite(idx)) entry = table[idx];
	} else if (typeof table === "object") {
		entry = (table as Record<string, any>)[String(key)];
		if (entry === undefined && key !== undefined && key !== null) {
			const maybeNum = Number(key);
			if (Number.isFinite(maybeNum)) entry = (table as Record<string, any>)[String(maybeNum)];
		}
	}

	if (entry === undefined || entry === null) return undefined;

	if (field) {
		// simple nested getter: support dot paths and numeric indices in brackets
		const path = String(field).replace(/\[(\d+)\]/g, '.$1');
		const tokens = path.split('.').filter(Boolean);
		let cur: any = entry;
		for (const t of tokens) {
			if (cur === undefined || cur === null) return undefined;
			cur = cur[t];
		}
		return cur === undefined ? undefined : cur;
	}

	return entry;
}