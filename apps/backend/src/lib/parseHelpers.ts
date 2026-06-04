import { Buffer } from "buffer";
import YAML from "yaml";

export function tryParseJson(value: string) {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export function tryParseYaml(value: string) {
	try {
		return YAML.parse(value);
	} catch {
		return null;
	}
}

export function tryDecodeBase64Json(value: string) {
	try {
		const decoded = Buffer.from(value, "base64").toString("utf-8");
		return tryParseJson(decoded);
	} catch {
		return null;
	}
}

export function parseNullableJson(value: unknown) {
	if (value === undefined || value === null) {
		return null;
	}
	if (Array.isArray(value) || isPlainObject(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = tryParseJson(value);
		if (parsed !== null) {
			return parsed;
		}
		return tryDecodeBase64Json(value);
	}
	return null;
}

export function decodeBase64Json<T = Record<string, unknown>>(value: string): T | null {
	try {
		return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
	} catch {
		return null;
	}
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
