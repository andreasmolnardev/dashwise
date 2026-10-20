#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { resolveWidgetProperties, resolveWidgetRuntimeData } from "../packages/integrationskit/data/resolveProperties";
import Shortcuts from "../packages/integrationskit/Shortcuts";
import { assertSafeIntegrationUrl, guardedIntegrationFetch } from "../apps/backend/src/lib/integrations-sdk/network-guard";

type Args = { positional: string[]; options: Record<string, string[]>; flags: Set<string> };
type JsonRecord = Record<string, any>;
let redactionSecrets: string[] = [];

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	const options: Record<string, string[]> = {};
	const flags = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]!;
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const equalIndex = token.indexOf("=");
		const key = token.slice(2, equalIndex >= 0 ? equalIndex : undefined);
		if (equalIndex >= 0) {
			(options[key] ??= []).push(token.slice(equalIndex + 1));
		} else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
			(options[key] ??= []).push(argv[++i]!);
		} else {
			flags.add(key);
		}
	}
	return { positional, options, flags };
}

function option(args: Args, key: string) { return args.options[key]?.at(-1); }
function options(args: Args, key: string) { return args.options[key] ?? []; }
function help() {
	console.log(`Dashwise integration CLI\n\nUsage:\n  bun run integrations validate yaml <file>\n  bun run integrations test yaml <file> [--env-file <file>] [--env KEY=VALUE] [--fixture <json>] [--widget <key>] [--shortcuts] [--json]\n  bun run integrations inspect sdk <package-or-entry>\n  bun run integrations test sdk <package-or-entry> [--config <json-file>] [--env-file <file>] [--duration <seconds>] [--run-scheduled] [--action <id>] [--resource <collection/id>] [--input <json>] [--json]\n\nYAML tests run the existing integrations-kit resolver. SDK tests import a trusted local integration package and run it against in-memory resource, storage, scheduler, logger, activity, and event adapters. Both can call the configured upstream service directly. Secrets are read from config/env files and redacted from output.`);
}

function parseKeyValue(value: string, label: string): [string, string] {
	const index = value.indexOf("=");
	if (index <= 0) throw new Error(`${label} must use KEY=VALUE`);
	return [value.slice(0, index).trim(), value.slice(index + 1)];
}

async function readEnvFiles(files: string[] = []) {
	const values: Record<string, string> = {};
	for (const file of files) {
		const content = await readFile(resolve(file), "utf8");
		for (const [lineIndex, rawLine] of content.split(/\r?\n/).entries()) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
			const separator = normalized.indexOf("=");
			if (separator <= 0) throw new Error(`${file}:${lineIndex + 1}: expected KEY=VALUE`);
			const key = normalized.slice(0, separator).trim();
			let value = normalized.slice(separator + 1).trim();
			if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
			values[key] = value.replace(/\\n/g, "\n");
		}
	}
	return values;
}

async function readJsonOption(file: string | undefined): Promise<JsonRecord> {
	if (!file) return {};
	const parsed = JSON.parse(await readFile(resolve(file), "utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} must contain a JSON object`);
	return parsed;
}

function redact(value: unknown, secrets: string[], key = ""): unknown {
	if (/(?:token|secret|password|authorization|api.?key)/i.test(key)) return "[REDACTED]";
	if (typeof value === "string") {
		return secrets.reduce((result, secret) => secret ? result.split(secret).join("[REDACTED]") : result, value);
	}
	if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as JsonRecord).map(([childKey, childValue]) => [childKey, redact(childValue, secrets, childKey)]));
	}
	return value;
}

function print(value: unknown, json: boolean, secrets: string[] = []) {
	const safe = redact(value, secrets);
	console.log(json ? JSON.stringify(safe) : JSON.stringify(safe, null, 2));
}

function validateYamlDefinition(definition: JsonRecord, file: string) {
	const problems: string[] = [];
	if (!definition || typeof definition !== "object" || Array.isArray(definition)) problems.push("The YAML root must be a mapping.");
	if (!definition.details?.name) problems.push("details.name is required.");
	if (!definition.configuration || typeof definition.configuration !== "object") problems.push("configuration must be a mapping.");
	const config = definition.configuration ?? {};
	if (config.endpoints !== undefined && (!config.endpoints || typeof config.endpoints !== "object" || Array.isArray(config.endpoints))) problems.push("configuration.endpoints must be a mapping.");
	if (config.computed !== undefined && (!config.computed || typeof config.computed !== "object" || Array.isArray(config.computed))) problems.push("configuration.computed must be a mapping.");
	for (const [id, endpoint] of Object.entries(config.endpoints ?? {}) as [string, JsonRecord][]) {
		if (!endpoint || typeof endpoint !== "object") problems.push(`Endpoint ${id} must be a mapping.`);
		else if (typeof endpoint.url !== "string" || !endpoint.url.trim()) problems.push(`Endpoint ${id} must define a URL.`);
	}
	const keys = new Set<string>();
	for (const [index, widget] of (Array.isArray(config.widgets) ? config.widgets : []).entries()) {
		if (!widget || typeof widget !== "object") { problems.push(`Widget ${index + 1} must be a mapping.`); continue; }
		if (typeof widget.key !== "string" || !widget.key.trim()) problems.push(`Widget ${index + 1} needs a stable key.`);
		else if (keys.has(widget.key)) problems.push(`Widget key "${widget.key}" is duplicated.`);
		else keys.add(widget.key);
	}
	if (problems.length) throw new Error(`${file}:\n- ${problems.join("\n- ")}`);
	return {
		name: definition.details.name,
		version: definition.details.version,
		endpointCount: Object.keys(config.endpoints ?? {}).length,
		computedCount: Object.keys(config.computed ?? {}).length,
		widgetCount: Array.isArray(config.widgets) ? config.widgets.length : 0,
		glanceableCount: Array.isArray(config.glanceables) ? config.glanceables.length : 0,
		shortcutGroupCount: Array.isArray(config.shortcuts) ? config.shortcuts.length : 0,
	};
}

async function runYaml(args: Args, command: "validate" | "test", file: string) {
	const source = await readFile(resolve(file), "utf8");
	const definition = YAML.parse(source) as JsonRecord;
	const summary = validateYamlDefinition(definition, file);
	if (command === "validate") return { ok: true, kind: "yaml", file: resolve(file), ...summary };

	const config = definition.configuration ?? {};
	const env = { ...await readEnvFiles(options(args, "env-file")) };
	for (const pair of options(args, "env")) {
		const [key, value] = parseKeyValue(pair, "--env");
		env[key] = value;
	}
	const declaredEnv = config.environment_variables ?? {};
	for (const [key, spec] of Object.entries(declaredEnv) as [string, JsonRecord][]) {
		if (env[key] === undefined && process.env[key] !== undefined) env[key] = process.env[key]!;
		if (env[key] === undefined && spec?.default !== undefined) env[key] = String(spec.default);
	}
	const missing = Object.entries(declaredEnv)
		.filter(([key, spec]) => (spec as JsonRecord)?.required === true && (env[key] === undefined || env[key] === ""))
		.map(([key]) => key);
	if (missing.length) throw new Error(`Missing required integration values: ${missing.join(", ")}. Supply --env KEY=VALUE or --env-file.`);

	const fixturePath = option(args, "fixture");
	const secrets = Object.entries(declaredEnv)
		.filter(([key, spec]) => /token|secret|password|key/i.test(key) || (spec as JsonRecord)?.edit === "overwrite-only")
		.map(([key]) => env[key]).filter((value): value is string => Boolean(value));
	redactionSecrets = secrets;
	let fixture: JsonRecord | null = null;
	if (fixturePath) fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
		if (!fixture) return originalFetch(input, { ...init, signal });
			const requestUrl = input instanceof Request ? input.url : String(input);
			const endpointName = Object.entries(config.endpoints ?? {}).find(([, ep]) => {
				const endpointUrl = String((ep as JsonRecord)?.url ?? "");
				return requestUrl.includes(endpointUrl.split("?")[0]!.split("/").at(-1) ?? "");
			})?.[0];
			const entry = fixture?.[endpointName ?? ""] ?? fixture?.[requestUrl] ?? fixture?.default;
			if (entry === undefined) throw new Error(`No fixture response matches ${requestUrl}`);
			const response = entry && typeof entry === "object" && "body" in entry ? entry as JsonRecord : { body: entry };
			const body = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
			return new Response(body, { status: Number(response.status ?? 200), headers: { "content-type": "application/json", ...(response.headers ?? {}) } });
	};

	try {
		const baseEnv = env;
		const integrationRuntimeInput = { data: { input: env } };
		const runtime = await resolveWidgetRuntimeData({
			widgetJSON: integrationRuntimeInput, integrationJSON: definition, data: null, isPreview: false,
			allowInsecureEndpoints: args.flags.has("allow-insecure-tls"),
		});
		const data = runtime.data ?? {};
		const widgetDefinitions = Array.isArray(config.widgets) ? config.widgets : [];
		const widgetFilter = option(args, "widget");
		const widgets = widgetDefinitions
			.filter((widget: JsonRecord) => !widgetFilter || widget.key === widgetFilter || widget.name === widgetFilter)
			.map((widget: JsonRecord) => {
				const widgetJSON = {
					...widget,
					data: { ...(widget.data ?? {}), input: { ...(widget.data?.input ?? {}), ...env } },
				};
				return {
					key: widget.key,
					name: widget.name,
					template: widget.template ?? "columns",
					resolved: resolveWidgetProperties({ widgetJSON, integrationJSON: definition, data, isPreview: false, allowInsecureEndpoints: args.flags.has("allow-insecure-tls") }),
				};
			});
		if (widgetFilter && !widgets.length) throw new Error(`Widget not found: ${widgetFilter}`);
		let shortcuts: unknown;
		if (args.flags.has("shortcuts")) {
			shortcuts = await Shortcuts({ integrationDefinition: definition, env: baseEnv, allowInsecureEndpoints: args.flags.has("allow-insecure-tls") });
		}
		return redact({
			ok: true, kind: "yaml", file: resolve(file), integration: summary,
			mode: fixture ? "fixture" : "live",
			endpoints: data.endpoints ?? {}, computed: data.computed ?? {},
			widgets, ...(shortcuts ? { shortcuts } : {}),
		}, secrets);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

function validateSdkConfig(definition: JsonRecord, supplied: JsonRecord) {
	const config: JsonRecord = {};
	const secrets: string[] = [];
	const unknown = Object.keys(supplied).filter((key) => !(key in (definition.config ?? {})));
	if (unknown.length) throw new Error(`Unknown SDK config field(s): ${unknown.join(", ")}`);
	for (const [key, field] of Object.entries(definition.config ?? {}) as [string, JsonRecord][]) {
		let value = supplied[key] ?? field.default;
		if (typeof value === "string" && field.type === "number" && value.trim()) value = Number(value);
		if (typeof value === "string" && field.type === "boolean" && /^(true|false)$/i.test(value)) value = value.toLowerCase() === "true";
		if (typeof value === "string" && field.type === "enum" && !field.options.includes(value) && field.options.includes(Number(value))) value = Number(value);
		if (value === undefined || value === "") {
			if (field.required) throw new Error(`Missing required SDK config: ${key}`);
			continue;
		}
		if (field.type === "secret") {
			if (typeof value !== "string") throw new Error(`SDK secret ${key} must be a string`);
			secrets.push(value);
		} else if (field.type === "url") {
			try { const url = new URL(String(value)); if (!/^https?:$/.test(url.protocol)) throw new Error(); }
			catch { throw new Error(`SDK config ${key} must be an HTTP(S) URL`); }
			config[key] = value;
		} else if (field.type === "number") {
			if (typeof value !== "number" || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) throw new Error(`Invalid SDK number config: ${key}`);
			config[key] = value;
		} else if (field.type === "boolean") {
			if (typeof value !== "boolean") throw new Error(`Invalid SDK boolean config: ${key}`);
			config[key] = value;
		} else if (field.type === "enum" && !field.options.includes(value)) {
			throw new Error(`Invalid SDK enum config: ${key}`);
		} else {
			if (typeof value !== "string") throw new Error(`SDK config ${key} must be a string`);
			config[key] = value;
		}
	}
	return { config, secrets: Object.fromEntries(Object.entries(supplied).filter(([key]) => definition.config?.[key]?.type === "secret")), secretValues: secrets };
}

async function loadSdkDefinition(specifier: string): Promise<JsonRecord> {
	let target = resolve(specifier);
	if (!existsSync(target)) {
		try {
			const loaded = await import(specifier);
			return loaded.default ?? loaded.integration ?? loaded;
		} catch (error) {
			throw new Error(`Could not import SDK integration "${specifier}": ${messageOf(error)}`);
		}
	}
	if (target.endsWith(".json")) {
		const pkg = JSON.parse(await readFile(target, "utf8"));
		target = resolve(dirname(target), pkg.main ?? "src/index.ts");
	} else if (existsSync(join(target, "package.json"))) {
		const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
		target = resolve(target, pkg.main ?? "src/index.ts");
	} else if (!/\.(?:[cm]?[jt]sx?)$/.test(target)) {
		target = join(target, "src/index.ts");
	}
	const loaded = await import(pathToFileURL(target).href);
	const definition = loaded.default ?? loaded.integration;
	if (!definition || typeof definition !== "object" || typeof definition.start !== "function" && typeof definition.setup !== "function") {
		throw new Error(`${specifier} does not export a default SDK integration definition.`);
	}
	return definition;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

async function runSdk(args: Args, command: "inspect" | "test", specifier: string) {
	const definition = await loadSdkDefinition(specifier);
	const manifest = {
		id: definition.id, name: definition.name, version: definition.version,
		description: definition.description,
		config: Object.entries(definition.config ?? {}).map(([key, field]: [string, any]) => ({ key, ...field, ...(field.type === "secret" ? { default: undefined } : {}) })),
		resources: Object.fromEntries(Object.entries(definition.resources ?? {}).map(([key, value]: [string, any]) => [key, { persistent: value.persistent === true, shortcuts: value.shortcuts === true, apps: value.apps ?? [] }])),
		apps: definition.apps ?? [], actions: Object.values(definition.actions ?? {}).map((action: any) => ({ id: action.id, name: action.name, description: action.description })),
		widgets: definition.widgets ?? [], glanceables: definition.glanceables ?? [],
	};
	if (command === "inspect") return { ok: true, kind: "sdk", integration: manifest };

	const configInput = await readJsonOption(option(args, "config"));
	const envConfig = await readEnvFiles(options(args, "env-file"));
	for (const key of Object.keys(definition.config ?? {})) if (envConfig[key] !== undefined) configInput[key] = envConfig[key];
	for (const pair of options(args, "env")) {
		const [key, raw] = parseKeyValue(pair, "--env");
		configInput[key] = raw;
	}
	const { config, secretValues } = validateSdkConfig(definition, configInput);
	redactionSecrets = secretValues;
	const host = createSdkTestHost(definition, config, configInput, secretValues);
	let actionResult: unknown;
	try {
		await definition.setup?.(host.api);
		await definition.start?.(host.api);
		const duration = Number(option(args, "duration") ?? 0);
		if (duration > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(duration, 300_000) * 1000));
		if (args.flags.has("run-scheduled")) {
			for (const task of host.scheduled.values()) await task(new AbortController().signal);
		}
		const actionId = option(args, "action");
		if (actionId) {
			const resourceRef = option(args, "resource") ?? "";
			const slash = resourceRef.indexOf("/");
			if (slash <= 0) throw new Error("--action requires --resource <collection/id>");
			const resource = host.resources.get(resourceRef.slice(0, slash))?.get(resourceRef.slice(slash + 1));
			if (!resource) throw new Error(`Resource not found: ${resourceRef}`);
			const action = Object.values(definition.actions ?? {}).find((item: any) => item.id === actionId) as any;
			if (!action) throw new Error(`Action not found: ${actionId}`);
			const input = option(args, "input") ? JSON.parse(option(args, "input")!) : {};
			actionResult = await action.execute(host.api, resource, input, new AbortController().signal);
		}
		return redact({
			ok: true, kind: "sdk", integration: manifest,
			resources: Object.fromEntries([...host.resources].map(([collection, records]) => [collection, [...records.values()]])),
			scheduledTasks: [...host.schedulerNames], logs: host.logs,
			activities: host.activities, events: host.events,
			...(actionResult !== undefined ? { actionResult } : {}),
		}, secretValues);
	} finally {
		await host.dispose();
	}
}

function createSdkTestHost(definition: JsonRecord, config: JsonRecord, configInput: JsonRecord, secretValues: string[]) {
	const instanceId = `local-test-${crypto.randomUUID()}`;
	const resources = new Map<string, Map<string, JsonRecord>>();
	for (const id of Object.keys(definition.resources ?? {})) resources.set(id, new Map());
	const storage = new Map<string, unknown>();
	const subscribers = new Map<string, Set<(event: any) => void | Promise<void>>>();
	const cleanups: Array<() => void | Promise<void>> = [];
	const scheduled = new Map<string, (signal: AbortSignal) => void | Promise<void>>();
	const schedulerNames = new Set<string>();
	const logs: JsonRecord[] = [];
	const activities: JsonRecord[] = [];
	const events: JsonRecord[] = [];
	const allowedPrivateUrls = Object.entries(definition.config ?? {}).filter(([key, field]: [string, any]) => field.type === "url" && typeof config[key] === "string").map(([key]) => config[key] as string);
	const collectionApis: JsonRecord = {};
	for (const [collectionId, records] of resources) {
		collectionApis[collectionId] = {
			get: (id: string) => records.get(id),
			upsert: async (resource: JsonRecord) => { records.set(resource.id, structuredClone(resource)); return records.get(resource.id); },
			update: async (id: string, changes: JsonRecord) => { const current = records.get(id); if (!current) return undefined; records.set(id, { ...current, ...structuredClone(changes) }); return records.get(id); },
			remove: async (id: string) => records.delete(id),
			sync: async (incoming: JsonRecord[], options: { completeness: "complete" | "partial" }) => {
				const seen = new Set<string>();
				for (const resource of incoming) { seen.add(resource.id); records.set(resource.id, structuredClone(resource)); }
				if (options.completeness === "complete") for (const id of records.keys()) if (!seen.has(id)) records.delete(id);
			},
		};
	}
	let api: JsonRecord;
	api = {
		instanceId,
		config: Object.freeze(config),
		secrets: { get: async (key: string) => typeof configInput[key] === "string" ? configInput[key] : undefined },
		resources: collectionApis,
		storage: {
			get: async (key: string) => storage.get(key),
			set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
			delete: async (key: string) => { storage.delete(key); },
		},
		actions: { execute: async (actionId: string, identity: JsonRecord, input: unknown) => {
			if (identity.integrationInstanceId !== instanceId) return { success: false, error: { code: "not_found", message: "Integration instance mismatch." } };
			const resource = resources.get(identity.collectionId)?.get(identity.resourceId);
			const action = Object.values(definition.actions ?? {}).find((item: any) => item.id === actionId) as any;
			if (!resource || !action) return { success: false, error: { code: "not_found", message: "Action or resource not found." } };
			return action.execute(api, resource, input, new AbortController().signal);
		} },
		activities: { publish: async (activity: JsonRecord) => { activities.push(structuredClone(activity)); return { id: `activity-${activities.length}`, duplicate: false }; } },
		events: {
			publish: (event: JsonRecord) => { events.push(structuredClone(event)); for (const handler of subscribers.get(event.name) ?? []) void handler(event); },
			subscribe: (name: string, handler: (event: any) => void | Promise<void>) => { const handlers = subscribers.get(name) ?? new Set(); handlers.add(handler); subscribers.set(name, handlers); return () => handlers.delete(handler); },
		},
		http: {
			fetch: (input: string | URL, init: RequestInit = {}) => guardedIntegrationFetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) }, { allowedPrivateUrls }),
			assertSafeUrl: (input: string | URL, protocols?: readonly string[]) => assertSafeIntegrationUrl(input, protocols, undefined, allowedPrivateUrls),
		},
		websocket: {
			connect: async (input: string | URL, protocols?: string | string[]) => {
				const url = await assertSafeIntegrationUrl(input, ["ws:", "wss:"], undefined, allowedPrivateUrls);
				const socket = new WebSocket(url, protocols);
				await new Promise<void>((resolvePromise, reject) => {
					const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket connection timed out after 15 seconds")); }, 15_000);
					socket.addEventListener("open", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
					socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); }, { once: true });
				});
				return socket;
			},
		},
		mcp: { call: async () => { throw new Error("MCP calls are unavailable in the local test host."); } },
		scheduler: {
			every: (name: string, intervalMs: number, task: (signal: AbortSignal) => unknown) => { schedulerNames.add(name); scheduled.set(name, task as any); if (intervalMs < 100) throw new Error(`Scheduler interval too short: ${name}`); },
			timeout: (name: string, _delayMs: number, task: (signal: AbortSignal) => unknown) => { schedulerNames.add(name); scheduled.set(name, task as any); },
			cancel: (name: string) => { scheduled.delete(name); schedulerNames.delete(name); },
		},
		logger: Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (message: string, metadata?: unknown) => logs.push({ level, message, metadata })])),
		onDispose: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); },
	};
	return {
		api,
		resources,
		storage,
		scheduled,
		schedulerNames,
		logs,
		activities,
		events,
		async dispose() {
			await definition.stop?.(api);
			for (const name of [...scheduled.keys()]) scheduled.delete(name);
			for (const cleanup of cleanups.reverse()) await cleanup();
			await definition.dispose?.(api);
		},
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.flags.has("help") || args.positional.length === 0) return help();
	const [command, kind, target] = args.positional;
	if (command === "validate" && kind === "yaml" && target) return print(await runYaml(args, "validate", target), args.flags.has("json"));
	if (command === "test" && kind === "yaml" && target) return print(await runYaml(args, "test", target), args.flags.has("json"), Object.values(await readEnvFiles(options(args, "env-file"))));
	if (command === "inspect" && kind === "sdk" && target) return print(await runSdk(args, "inspect", target), args.flags.has("json"));
	if (command === "test" && kind === "sdk" && target) return print(await runSdk(args, "test", target), args.flags.has("json"));
	throw new Error("Invalid command. Run `bun run integrations -- --help` for usage.");
}

main().catch((error) => {
	console.error(`Integration CLI: ${redact(messageOf(error), redactionSecrets)}`);
	process.exitCode = 1;
});
