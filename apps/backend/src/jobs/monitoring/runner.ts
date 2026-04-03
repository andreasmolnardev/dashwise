import { config } from "../../config/env";

import { monitorHelper, MonitoringRequestAuth } from "./helper";
import {
    createMonitoringJobStatusLog,
    getMonitoringJobs,
    getUserConfigsByAssociatedUserId,
    updateMonitoringJob,
} from "@dashwise/sdk/data/superuser";

type StatusCheckMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

type LinkCheckConfig = {
    id?: string;
    url?: string;
    statusCheck?: boolean;
    statusCheckEndpoint?: string;
    statusCheckMethod?: StatusCheckMethod;
    statusCheckAuth?: unknown;
    statusCheckShowAsUp?: number[];
};

export async function runStatusMonitoringJobs(): Promise<{
    processed: number;
    skipped: number;
    updated: number;
    logsCreated: number;
    errors: number;
    details: Array<any>;
}> {
    return runStatusMonitoringJobsWithOptions();
}

export async function runStatusMonitoringJobsWithOptions(options?: {
    source?: string;
    linkId?: string;
}): Promise<{
    processed: number;
    skipped: number;
    updated: number;
    logsCreated: number;
    errors: number;
    details: Array<any>;
}> {
    const result = { processed: 0, skipped: 0, updated: 0, logsCreated: 0, errors: 0, details: [] as any[] };
    const userLinkConfigCache = new Map<string, Map<string, LinkCheckConfig>>();

    console.log("running status monitoring jobs");

    // fetch all monitoring jobs (increase limit if you expect >2000)
    const requestedSource = options?.source || (options?.linkId ? `link ${options.linkId}` : undefined);
    const jobs = await getMonitoringJobs(2000, requestedSource ? `source = "${requestedSource}"` : undefined);

    for (const job of jobs) {
        const source = String(job.source || '');
        const linkId = source.startsWith('link ') ? source.slice(5) : undefined;
        const linkConfig = (job.userId && linkId)
            ? await getLinkConfigById(userLinkConfigCache, job.userId, linkId)
            : undefined;

        const endpoint = String(job.endpoint || linkConfig?.statusCheckEndpoint || linkConfig?.url || '').trim();
        if (!endpoint) {
            result.skipped++;
            result.details.push({ jobId: job.id, action: 'skipped', reason: 'no endpoint' });
            continue;
        }

        const method = normalizeMethod(linkConfig?.statusCheckMethod);
        const acceptedUpStatusCodes = resolveAcceptedUpCodes(job.acceptedUpStatusCodes, linkConfig?.statusCheckShowAsUp);
        const auth = resolveEndpointAuth(job.endpointAuth, linkConfig?.statusCheckAuth);
        const currentStatus = normalizeStatus(job.status);

        // optionally skip truly disabled jobs
        if (currentStatus === 'disabled') {
            result.skipped++;
            result.details.push({ jobId: job.id, action: 'skipped', reason: 'disabled' });
            continue;
        }

        result.processed++;

        try {
            const monitorInput: Parameters<typeof monitorHelper>[0] = {
                url: endpoint,
                allowSSL: config.ALLOW_SSL === true,
                method,
            };

            if (auth) {
                monitorInput.auth = auth;
            }

            const code = await monitorHelper(monitorInput);
            const newStatus = acceptedUpStatusCodes.has(code) ? 'healthy' : 'unhealthy';

            if (newStatus !== currentStatus) {
                // update job
                await updateMonitoringJob(job.id, { status: newStatus });

                // create log — relation field expects array of related ids in PocketBase
                await createMonitoringJobStatusLog({
                    job: [job.id],
                    status: newStatus,
                });

                result.updated++;
                result.logsCreated++;
                result.details.push({
                    jobId: job.id,
                    oldStatus: currentStatus,
                    newStatus,
                    httpStatus: code,
                    endpoint,
                    method,
                });
            } else {
                result.details.push({
                    jobId: job.id,
                    action: 'no_change',
                    status: currentStatus,
                    httpStatus: code,
                    endpoint,
                    method,
                });
            }
        } catch (err: any) {
            // network/fetch error: mark unhealthy and log if it represents a state change
            result.errors++;
            result.details.push({ jobId: job.id, action: 'fetch_error', error: err?.message || String(err) });

            try {
                if (currentStatus !== 'unhealthy') {
                    await updateMonitoringJob(job.id, { status: 'unhealthy' });
                    await createMonitoringJobStatusLog({
                        job: [job.id],
                        status: 'unhealthy',
                    });
                    result.updated++;
                    result.logsCreated++;
                    result.details.push({ jobId: job.id, oldStatus: currentStatus, newStatus: 'unhealthy', note: 'network/fetch error' });
                }
            } catch (uerr: any) {
                result.errors++;
                result.details.push({ jobId: job.id, action: 'update_error', error: uerr?.message || String(uerr) });
            }
        }
    }
    return result;
}

async function getLinkConfigById(
    cache: Map<string, Map<string, LinkCheckConfig>>,
    userId: string,
    linkId: string,
): Promise<LinkCheckConfig | undefined> {
    if (!cache.has(userId)) {
        const userConfigs = await getUserConfigsByAssociatedUserId(userId, 1000);

        const mapById = new Map<string, LinkCheckConfig>();
        for (const userConfig of userConfigs) {
            const parsedConfig = parseConfigObject(userConfig.config);
            const links = Array.isArray(parsedConfig.links) ? parsedConfig.links : [];

            for (const link of links) {
                if (link?.id) {
                    mapById.set(String(link.id), link as LinkCheckConfig);
                }
            }
        }

        cache.set(userId, mapById);
    }

    return cache.get(userId)?.get(linkId);
}

function parseConfigObject(rawConfig: any): any {
    if (!rawConfig) return {};
    if (typeof rawConfig === 'string') {
        try {
            return JSON.parse(rawConfig);
        } catch {
            return {};
        }
    }
    return rawConfig;
}

function normalizeStatus(raw: any): string {
    if (Array.isArray(raw)) {
        return String(raw[0] || 'initiated');
    }
    return String(raw || 'initiated');
}

function normalizeMethod(rawMethod?: string): StatusCheckMethod {
    const method = String(rawMethod || 'GET').toUpperCase();
    const allowed: StatusCheckMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (allowed.includes(method as StatusCheckMethod)) {
        return method as StatusCheckMethod;
    }
    return 'GET';
}

function resolveAcceptedUpCodes(rawJobCodes: unknown, fallbackCodes?: number[]): Set<number> {
    const parsed = parseAcceptedCodeList(rawJobCodes);
    if (parsed.length > 0) {
        return new Set(parsed);
    }

    if (Array.isArray(fallbackCodes) && fallbackCodes.length > 0) {
        const normalizedFallback = fallbackCodes
            .map((entry) => Number(entry))
            .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
        if (normalizedFallback.length > 0) {
            return new Set(normalizedFallback);
        }
    }

    const defaults: number[] = [];
    for (let code = 200; code < 400; code++) {
        defaults.push(code);
    }
    return new Set(defaults);
}

function parseAcceptedCodeList(raw: unknown): number[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw
            .map((entry) => Number(entry))
            .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
    }

    if (typeof raw !== 'string') return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((entry) => Number(entry))
                    .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
            }
        } catch {
            return [];
        }
    }

    return trimmed
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
}

function resolveEndpointAuth(rawJobAuth: unknown, fallbackAuth?: unknown): MonitoringRequestAuth | undefined {
    const fromJob = parseMonitoringAuth(rawJobAuth);
    if (fromJob) return fromJob;
    return parseMonitoringAuth(fallbackAuth);
}

function parseMonitoringAuth(raw: unknown): MonitoringRequestAuth | undefined {
    if (!raw) return undefined;

    let parsed: any = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;

        try {
            parsed = JSON.parse(trimmed);
        } catch {
            return undefined;
        }
    }

    if (!parsed || typeof parsed !== 'object') return undefined;

    if (parsed.type === 'bearer' && typeof parsed.token === 'string' && parsed.token.trim()) {
        return { type: 'bearer', token: parsed.token.trim() };
    }

    if (parsed.type === 'basic' && typeof parsed.username === 'string' && parsed.username.trim()) {
        return {
            type: 'basic',
            username: parsed.username.trim(),
            password: typeof parsed.password === 'string' ? parsed.password : '',
        };
    }

    if (parsed.type === 'header' && typeof parsed.name === 'string' && parsed.name.trim()) {
        return {
            type: 'header',
            name: parsed.name.trim(),
            value: typeof parsed.value === 'string' ? parsed.value : '',
        };
    }

    return undefined;
}
