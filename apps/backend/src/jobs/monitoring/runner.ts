import { config } from "../../lib/config";

import { monitorHelper, MonitoringRequestAuth, MonitoringRequestResult } from "./helper";
import {
    getMonitoringJobs,
    getUserConfigsByAssociatedUserId,
    updateMonitoringJob,
} from "../../lib/data/superuser";
import {
    createNotificationByTopicId,
    queueNotificationForForwarding,
} from "../../lib/data/notifications/publish";
import { createLogger } from "../../lib/logger";
import { getLinkIdFromSource, getLinkSource, parseConfigObject, type StatusCheckMethod } from "./shared";

type LinkCheckConfig = {
    id?: string;
    url?: string;
    statusCheck?: boolean;
    statusCheckEndpoint?: string;
    statusCheckMethod?: StatusCheckMethod;
    statusCheckAuth?: unknown;
    statusCheckShowAsUp?: number[];
};

type ResponseUpFilter = {
    acceptStatusCodes?: unknown;
    acceptBodyProperties?: unknown;
} | string | null | undefined;

type OutlierThreshold = {
    type: "absolute" | "relative";
    value: number;
};

type PingOutlier = {
    created: string;
    latencyMs: number;
    threshold: OutlierThreshold;
    baselineMs?: number;
    deltaMs?: number;
    deltaPercent?: number;
};

type AvgLatencyInfo = {
    avgMs: number;
    samples: number;
};

const logger = createLogger("Monitoring");

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

    logger.info("Running status monitoring jobs");

    // fetch all monitoring jobs (increase limit if you expect >2000)
    const requestedSource = options?.source || (options?.linkId ? getLinkSource(options.linkId) : undefined);
    const jobs = await getMonitoringJobs(2000, requestedSource ? `source = "${requestedSource}"` : undefined);

    for (const job of jobs) {
        const source = String(job.source || '');
        const linkId = getLinkIdFromSource(source);
        const linkConfig = (job.userId && linkId)
            ? await getLinkConfigById(userLinkConfigCache, job.userId, linkId)
            : undefined;

        const endpoint = String(job.endpoint || linkConfig?.statusCheckEndpoint || linkConfig?.url || '').trim();
        if (!endpoint) {
            result.skipped++;
            result.details.push({ jobId: job.id, action: 'skipped', reason: 'no endpoint' });
            continue;
        }

        const method = normalizeMethod(job.method || linkConfig?.statusCheckMethod);
        const responseUpFilter = resolveResponseUpFilter(job.responseUpFilter as ResponseUpFilter, job.acceptedUpStatusCodes, linkConfig?.statusCheckShowAsUp);
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

            let resultData: MonitoringRequestResult;
            let isRetry = false;

            try {
                resultData = await monitorHelper(monitorInput);
            } catch (firstErr: any) {
                isRetry = true;
                logger.warn("First ping failed, retrying", { endpoint, error: firstErr?.message || String(firstErr) });
                await new Promise(resolve => setTimeout(resolve, config.JOBS_MONITORING_RETRY_AFTER));
                resultData = await monitorHelper(monitorInput);
            }

            const statusAccepted = responseUpFilter.acceptStatusCodes.has(resultData.status);
            const bodyAccepted = matchesExpectedBody(responseUpFilter.acceptBodyProperties, resultData.body, resultData.contentType);
            let newStatus = statusAccepted && bodyAccepted ? 'healthy' : 'unhealthy';

            if (!isRetry && newStatus === 'unhealthy') {
                logger.warn("First ping returned unhealthy, retrying", { endpoint, httpStatus: resultData.status });
                await new Promise(resolve => setTimeout(resolve, config.JOBS_MONITORING_RETRY_AFTER));
                try {
                    const retryData = await monitorHelper(monitorInput);
                    const retryStatusAccepted = responseUpFilter.acceptStatusCodes.has(retryData.status);
                    const retryBodyAccepted = matchesExpectedBody(responseUpFilter.acceptBodyProperties, retryData.body, retryData.contentType);

                    if (retryStatusAccepted && retryBodyAccepted) {
                        resultData = retryData;
                        newStatus = 'healthy';
                    }
                } catch {
                    // retry also failed, keep original unhealthy result
                }
            }
            const pingTimestamp = new Date().toISOString();
            const latencyUpdate = buildLatencyUpdate(job, resultData.latencyMs, pingTimestamp);

            if (latencyUpdate.isOutlier) {
                logger.info("Response time outlier detected", {
                    jobId: job.id,
                    latencyMs: resultData.latencyMs,
                    threshold: job?.pingOutlierThreshold || config.MONITORING_OUTLIER_THRESHOLD_VALUE,
                });
            }

            if (newStatus !== currentStatus) {
                const existingPings = normalizePings(job.pings);
                const updatedPings = [
                    ...existingPings,
                    {
                        status: newStatus,
                        created: pingTimestamp,
                        httpStatus: resultData.status,
                        method,
                        endpoint,
                        latencyMs: resultData.latencyMs,
                    },
                ];

                await updateMonitoringJob(job.id, {
                    status: newStatus,
                    pings: updatedPings,
                    ...latencyUpdate.payload,
                });

                if (job.notifyOnStatusChange && job.notifyTopicId) {
                    try {
                        const content = `Monitor "${job.title || job.endpoint || job.source || 'Unnamed'}" changed from ${currentStatus} to ${newStatus}`;
                        const { itemId } = await createNotificationByTopicId(job.notifyTopicId, content, 'monitoring');
                        await queueNotificationForForwarding(itemId);
                    } catch (err: any) {
                        logger.error("Failed to send notification for monitor status change", { jobId: job.id, error: err.message });
                    }
                }

                result.updated++;
                result.logsCreated++;
                result.details.push({
                    jobId: job.id,
                    oldStatus: currentStatus,
                    newStatus,
                    httpStatus: resultData.status,
                    endpoint,
                    method,
                });
            } else {
                await updateMonitoringJob(job.id, {
                    ...latencyUpdate.payload,
                });
                result.details.push({
                    jobId: job.id,
                    action: 'no_change',
                    status: currentStatus,
                    httpStatus: resultData.status,
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
                    const existingPings = normalizePings(job.pings);
                    const updatedPings = [
                        ...existingPings,
                        {
                            status: 'unhealthy',
                            created: new Date().toISOString(),
                            endpoint,
                            method,
                        },
                    ];

                    await updateMonitoringJob(job.id, {
                        status: 'unhealthy',
                        pings: updatedPings,
                    });

                    if (job.notifyOnStatusChange && job.notifyTopicId) {
                        try {
                            const content = `Monitor "${job.title || job.endpoint || job.source || 'Unnamed'}" changed from ${currentStatus} to unhealthy (fetch error)`;
                            const { itemId } = await createNotificationByTopicId(job.notifyTopicId, content, 'monitoring');
                            await queueNotificationForForwarding(itemId);
                        } catch (nerr: any) {
                            logger.error("Failed to send notification for monitor status change (error)", { jobId: job.id, error: nerr.message });
                        }
                    }

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

function resolveResponseUpFilter(rawJobFilter: ResponseUpFilter, legacyStatusCodes: unknown, fallbackCodes?: number[]) {
    const parsedFromJob = parseResponseUpFilter(rawJobFilter);
    const acceptStatusCodes = parsedFromJob?.acceptStatusCodes ?? legacyStatusCodes;
    const resolvedStatusCodes = resolveAcceptedUpCodes(acceptStatusCodes, fallbackCodes);

    return {
        acceptStatusCodes: resolvedStatusCodes,
        acceptBodyProperties: parsedFromJob?.acceptBodyProperties,
    };
}

function parseResponseUpFilter(raw: ResponseUpFilter): { acceptStatusCodes?: unknown; acceptBodyProperties?: unknown } | undefined {
    if (!raw) return undefined;

    let parsed: any = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;

        try {
            parsed = JSON.parse(trimmed);
        } catch {
            return { acceptStatusCodes: trimmed };
        }
    }

    if (!parsed || typeof parsed !== 'object') return undefined;

    return {
        acceptStatusCodes: parsed.acceptStatusCodes,
        acceptBodyProperties: parsed.acceptBodyProperties,
    };
}

async function getLinkConfigById(
    cache: Map<string, Map<string, LinkCheckConfig>>,
    userId: string,
    linkId: string,
): Promise<LinkCheckConfig | undefined> {
    if (!cache.has(userId)) {
        const userConfigs = await getUserConfigsByAssociatedUserId(userId, 1000);

        if (!userConfigs || userConfigs.length === 0) {
            return undefined;   
        }

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

function normalizePings(raw: unknown): any[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw;
    }

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function normalizeOutliers(raw: unknown): PingOutlier[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw as PingOutlier[];
    }

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as PingOutlier[]) : [];
        } catch {
            return [];
        }
    }

    return [];
}

function parseOutlierThreshold(raw: unknown, fallback: OutlierThreshold): OutlierThreshold {
    if (!raw) return fallback;

    if (typeof raw === "number" && Number.isFinite(raw)) {
        return { type: "absolute", value: raw };
    }

    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return fallback;

        if (trimmed.endsWith("%")) {
            const value = Number(trimmed.slice(0, -1));
            return Number.isFinite(value) ? { type: "relative", value } : fallback;
        }

        try {
            const parsed = JSON.parse(trimmed);
            return parseOutlierThreshold(parsed, fallback);
        } catch {
            const value = Number(trimmed);
            return Number.isFinite(value) ? { type: "absolute", value } : fallback;
        }
    }

    if (typeof raw === "object" && raw) {
        const type = (raw as any).type === "absolute" ? "absolute" : (raw as any).type === "relative" ? "relative" : fallback.type;
        const value = Number((raw as any).value);
        if (Number.isFinite(value)) {
            return { type, value };
        }
    }

    return fallback;
}

function parseAvgLatency(raw: unknown): AvgLatencyInfo {
    if (!raw) return { avgMs: 0, samples: 0 };

    if (typeof raw === "number" && Number.isFinite(raw)) {
        return { avgMs: raw, samples: 0 };
    }

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parseAvgLatency(parsed);
        } catch {
            const value = Number(raw);
            if (Number.isFinite(value)) {
                return { avgMs: value, samples: 0 };
            }
        }
    }

    if (typeof raw === "object" && raw) {
        const avgMs = Number((raw as any).avgMs);
        const samples = Number((raw as any).samples);
        return {
            avgMs: Number.isFinite(avgMs) ? avgMs : 0,
            samples: Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0,
        };
    }

    return { avgMs: 0, samples: 0 };
}

function buildLatencyUpdate(job: any, latencyMs: number, created: string) {
    const fallback: OutlierThreshold = {
        type: config.MONITORING_OUTLIER_THRESHOLD_TYPE,
        value: config.MONITORING_OUTLIER_THRESHOLD_VALUE,
    };
    const threshold = parseOutlierThreshold(job?.pingOutlierThreshold, fallback);
    const shouldPersistThreshold = !job?.pingOutlierThreshold;
    const avgInfo = parseAvgLatency(job?.pingAvgLatency);
    const newSamples = avgInfo.samples + 1;
    const newAvg = avgInfo.samples > 0
        ? (avgInfo.avgMs * avgInfo.samples + latencyMs) / newSamples
        : latencyMs;
    const normalizedAvg = Number(newAvg.toFixed(2));

    const payload: Record<string, unknown> = {
        pingAvgLatency: JSON.stringify({ avgMs: normalizedAvg, samples: newSamples }),
    };

    if (shouldPersistThreshold) {
        payload.pingOutlierThreshold = threshold;
    }

    let isOutlier = false;
    let deltaMs: number | undefined;
    let deltaPercent: number | undefined;
    const baselineMs = avgInfo.samples > 0 ? avgInfo.avgMs : undefined;

    if (threshold.type === "absolute") {
        isOutlier = latencyMs > threshold.value;
        if (isOutlier) {
            deltaMs = latencyMs - threshold.value;
        }
    } else if (baselineMs && baselineMs > 0) {
        const limit = baselineMs * (1 + threshold.value / 100);
        isOutlier = latencyMs > limit;
        if (isOutlier) {
            deltaMs = latencyMs - baselineMs;
            deltaPercent = (deltaMs / baselineMs) * 100;
        }
    }

    if (isOutlier) {
        const updatedOutliers = normalizeOutliers(job?.pingOutliers);
        updatedOutliers.push({
            created,
            latencyMs,
            threshold,
            baselineMs,
            deltaMs: deltaMs !== undefined ? Number(deltaMs.toFixed(2)) : undefined,
            deltaPercent: deltaPercent !== undefined ? Number(deltaPercent.toFixed(2)) : undefined,
        });
        payload.pingOutliers = updatedOutliers;
    }

    return { payload, isOutlier };
}

function parseAcceptedCodeList(raw: unknown): number[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw
            .flatMap((entry) => parseStatusCodeEntry(entry))
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
                    .flatMap((entry) => parseStatusCodeEntry(entry))
                    .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
            }
        } catch {
            return [];
        }
    }

    return trimmed
        .split(',')
        .flatMap((entry) => parseStatusCodeEntry(entry.trim()))
        .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);
}

function parseStatusCodeEntry(entry: unknown): number[] {
    const text = String(entry ?? '').trim();
    if (!text) return [];

    const rangeMatch = text.match(/^(\d{3})-(\d{3})$/);
    if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (start <= end) {
            const values: number[] = [];
            for (let code = start; code <= end; code++) {
                values.push(code);
            }
            return values;
        }
    }

    const code = Number(text);
    return Number.isInteger(code) ? [code] : [];
}

function matchesExpectedBody(expected: unknown, rawBody: string, contentType?: string): boolean {
    const parsedExpected = parseExpectedBody(expected);
    if (parsedExpected === undefined) return true;

    if (typeof parsedExpected === 'string') {
        return rawBody.trim() === parsedExpected.trim();
    }

    const actualBody = parseActualBody(rawBody, contentType);
    if (actualBody === undefined) return false;

    return isExpectedSubset(parsedExpected, actualBody);
}

function parseExpectedBody(expected: unknown): unknown {
    if (expected === undefined || expected === null || expected === '') return undefined;
    if (typeof expected === 'string') {
        const trimmed = expected.trim();
        if (!trimmed) return undefined;
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed;
        }
    }
    return expected;
}

function parseActualBody(rawBody: string, contentType?: string): unknown {
    const trimmed = rawBody.trim();
    if (!trimmed) return '';
    if (!contentType?.includes('json') && !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
        return trimmed;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

function isExpectedSubset(expected: unknown, actual: unknown): boolean {
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || expected.length !== actual.length) return false;
        return expected.every((entry, index) => isExpectedSubset(entry, actual[index]));
    }

    if (expected && typeof expected === 'object') {
        if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;

        return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
            isExpectedSubset(value, (actual as Record<string, unknown>)[key]),
        );
    }

    return Object.is(expected, actual);
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
