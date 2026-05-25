import { flattenToEnv, getNestedValue, resolveComputedFieldValue } from "./data/getComputedField";
import { resolveIntegrationRuntimeProperties } from "./data/resolveProperties";

export type ShortcutActionObject = {
	type: string;
	url?: string;
	auth?: string;
	headers?: Record<string, string>;
	body?: unknown;
};

export type ShortcutItem = {
	id: string;
	name: string;
	icon: string;
	secondaryInfo: string;
	type: string;
	action: string | ShortcutActionObject;
	tags: string[];
};

export type ShortcutsInput = {
	integrationDefinition?: Record<string, any> | null;
	env?: Record<string, string> | null;
	allowInsecureEndpoints?: boolean;
};

function toTagList(raw: unknown) {
	if (Array.isArray(raw)) {
		return raw
			.map((entry) => String(entry ?? "").trim())
			.filter((entry): entry is string => entry.length > 0);
	}

	if (raw === undefined || raw === null) return [] as string[];
	const asString = String(raw).trim();
	return asString ? [asString] : [];
}

function resolvePathValue(root: Record<string, any>, current: unknown, rawPath: string, index = 0): unknown {
	const path = rawPath.trim().replace(/^this\./, "");
	if (!path) return "";
	if (path === "_index") return index;

	const currentValue =
		current && typeof current === "object"
			? getNestedValue(current as Record<string, any>, path)
			: undefined;
	if (currentValue !== undefined && currentValue !== null) {
		return currentValue;
	}

	const rootValue = getNestedValue(root, path);
	if (rootValue !== undefined && rootValue !== null) {
		return rootValue;
	}

	return undefined;
}

function resolveSearchString(root: Record<string, any>, current: unknown, template: string, index = 0) {
	const interpolated = template.replace(/\$\{([^}]+)\}/g, (_, expr) => {
		const value = resolvePathValue(root, current, String(expr), index);
		return value === undefined || value === null ? "" : String(value);
	});

	const trimmed = interpolated.trim();
	if (!trimmed) return "";

	const direct = resolvePathValue(root, current, trimmed, index);
	return direct !== undefined ? direct : trimmed;
}

function resolveShortcut(root: Record<string, any>, current: unknown, node: unknown, index = 0): unknown {
	if (node === undefined || node === null) return node;
	if (typeof node === "string") return resolveSearchString(root, current, node, index);
	if (typeof node === "number" || typeof node === "boolean") return node;

	if (Array.isArray(node)) {
		const resolvedEntries = node.map((entry) => resolveShortcut(root, current, entry, index));
		const shouldMergeObjects =
			resolvedEntries.length > 0 &&
			resolvedEntries.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry));

		if (!shouldMergeObjects) {
			return resolvedEntries;
		}

		const merged: Record<string, any> = {};
		for (const entry of resolvedEntries) {
			Object.assign(merged, entry as Record<string, any>);
		}
		return merged;
	}

	if (typeof node !== "object") return node;
	const objectNode = node as Record<string, any>;

	if (typeof objectNode.operation === "string") {
		const scopeRoot = {
			...root,
			current,
			item: current,
		};
		const env = {
			...flattenToEnv(root),
			...(current && typeof current === "object" ? flattenToEnv(current as Record<string, any>) : {}),
			_index: String(index),
		};
		return resolveComputedFieldValue(objectNode, {
			env,
			scope: scopeRoot,
			current: current && typeof current === "object" ? (current as Record<string, any>) : undefined,
			currentKey: String(index),
		});
	}

	if (typeof objectNode.iterate === "string" || typeof objectNode.iterate_over === "string") {
		const iteratePath = typeof objectNode.iterate === "string"
			? objectNode.iterate
			: objectNode.iterate_over;
		const source = resolvePathValue(root, current, String(iteratePath), index);
		const entries = Array.isArray(source)
			? source
			: source && typeof source === "object"
			? Object.values(source as Record<string, any>)
			: [];

		const mappingShape =
			objectNode.mappingProperties && typeof objectNode.mappingProperties === "object"
				? objectNode.mappingProperties
				: objectNode;

		return entries.map((entry, itemIndex) => {
			const mapped: Record<string, any> = {};
			for (const [key, value] of Object.entries(mappingShape)) {
				if (["iterate", "iterate_over", "mappingProperties"].includes(key)) continue;
				mapped[key] = resolveShortcut(root, entry, value, itemIndex);
			}
			return mapped;
		});
	}

	const output: Record<string, any> = {};
	for (const [key, value] of Object.entries(objectNode)) {
		output[key] = resolveShortcut(root, current, value, index);
	}
	return output;
}

export default async function Shortcuts({
	integrationDefinition = null,
	env = {},
    allowInsecureEndpoints = false,
}: ShortcutsInput): Promise<ShortcutItem[]> {
	const integrationJSON =
		integrationDefinition && typeof integrationDefinition === "object"
			? integrationDefinition
			: null;
	if (!integrationJSON) return [];

	const runtimeProperties = await resolveIntegrationRuntimeProperties({
		integrationJSON,
		env: env ?? {},
		isPreview: false,
		allowInsecureEndpoints: allowInsecureEndpoints,
	});

	const integrationConfig =
		integrationJSON?.configuration && typeof integrationJSON.configuration === "object"
			? (integrationJSON.configuration as Record<string, any>)
			: {};
	const resolvedShortcuts = Array.isArray(integrationConfig.shortcuts)
		? (integrationConfig.shortcuts as Array<Record<string, any>>)
		: [];

	const root = {
		...runtimeProperties.env,
		env: runtimeProperties.env,
		lookup_tables: runtimeProperties.lookup_tables ?? {},
		endpoints: runtimeProperties.endpoints ?? {},
		computed: runtimeProperties.computed ?? {},
	};

	const rows: ShortcutItem[] = [];

	for (const definition of resolvedShortcuts) {
		if (!definition || typeof definition !== "object") continue;

		for (const sectionValue of Object.values(definition as Record<string, any>)) {
			const resolved = resolveShortcut(root, root, sectionValue);
			const candidates = Array.isArray(resolved)
				? resolved
				: resolved && typeof resolved === "object"
				? Object.values(resolved as Record<string, any>)
				: [];

			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue;

				const item = candidate as Record<string, any>;
				const name = String(item.name ?? "").trim();
				const actionValue = item.action;
				const action = typeof actionValue === "string"
					? actionValue.trim()
					: actionValue;
				if (!name || !isValidShortcutAction(action)) continue;
 
				const fallbackId = typeof action === "string"
					? `${action}:${name}`
					: `${action.type}:${action.url ?? name}`;

				rows.push({
					id: String(item.id ?? fallbackId),
					name,
					icon: String(item.icon ?? ""),
					secondaryInfo: String(item.secondaryInfo ?? item.secondary ?? ""),
					type: String(item.type ?? "shortcut"),
					action,
					tags: toTagList(item.tags),
				});
			}
		}
	}

	return rows;
}

function isValidShortcutAction(action: unknown): action is string | ShortcutActionObject {
	if (typeof action === "string") {
		return action.trim().length > 0;
	}
	if (!action || typeof action !== "object" || Array.isArray(action)) {
		return false;
	}
	const type = String((action as ShortcutActionObject).type ?? "").trim();
	return type.length > 0;
}