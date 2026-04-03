import {
    createMonitoringJob,
    getAllUserConfigs,
    getMonitoringJobsByUserId,
    getUserConfigById,
    getUserConfigsByAssociatedUserId,
    updateMonitoringJob,
    updateUserConfigRecord,
} from "@dashwise/sdk/data/superuser";

type StatusCheckMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

type StatusCheckAuth =
    | { type: "bearer"; token: string }
    | { type: "basic"; username: string; password: string }
    | { type: "header"; name: string; value: string };

type ConfigLink = {
    id?: string;
    url?: string;
    statusCheck?: boolean;
    statusCheckEndpoint?: string;
    statusCheckMethod?: StatusCheckMethod;
    statusCheckAuth?: StatusCheckAuth | string;
    statusCheckShowAsUp?: number[];
};

export default async function indexStatusMonitoringJobs(): Promise<{
    created: number;
    skipped: number;
    updated: number;
    disabled: number;
    errors: number;
    details: Array<{ linkId?: string; endpoint?: string; userId?: string; action: string; error?: string }>;
}> {
    const result = { created: 0, skipped: 0, updated: 0, disabled: 0, errors: 0, details: [] as any[] };

    console.log("indexing monitoring jobs");

    try {
        // fetch all user configs
        const userConfigs = await getAllUserConfigs(1000);

        for (const userConfig of userConfigs) {
            const userId = userConfig.associatedUserId;

            if (!userId) {
                result.skipped++;
                result.details.push({ action: 'skipped', error: 'userConfig without associatedUserId', linkId: userConfig.id });
                continue;
            }

            await generateMissingLinkIds(userId);

            const refreshedUserConfig = await getUserConfigById(userConfig.id);

            let configLinks: ConfigLink[] = [];
            try {
                const parsedConfig = parseConfigObject(refreshedUserConfig.config);
                configLinks = (parsedConfig.links || []).filter((l: ConfigLink) => l.statusCheck === true);
            } catch (parseErr: any) {
                result.errors++;
                result.details.push({ action: 'error', error: 'Failed to parse userConfig.config', linkId: userConfig.id });
                continue;
            }

            const desiredJobsBySource = new Map<string, {
                endpoint: string;
                endpointAuth: string;
                acceptedUpStatusCodes: string;
            }>();

            for (const link of configLinks) {
                if (!link.id) {
                    result.skipped++;
                    result.details.push({ userId, action: 'skipped', error: 'missing link.id after id generation' });
                    continue;
                }

                const endpoint = String(link.statusCheckEndpoint || link.url || '').trim();
                if (!endpoint) {
                    result.skipped++;
                    result.details.push({ linkId: link.id, userId, action: 'skipped', error: 'no endpoint to monitor' });
                    continue;
                }

                const source = `link ${link.id}`;
                desiredJobsBySource.set(source, {
                    endpoint,
                    endpointAuth: serializeStatusCheckAuth(link.statusCheckAuth),
                    acceptedUpStatusCodes: serializeAcceptedStatusCodes(link.statusCheckShowAsUp),
                });
            }

            const existingJobs = await getMonitoringJobsByUserId(userId, 2000);

            const existingBySource = new Map<string, any>();
            for (const job of existingJobs) {
                if (typeof job.source === 'string') {
                    existingBySource.set(job.source, job);
                }
            }

            for (const [source, desired] of desiredJobsBySource.entries()) {
                const linkId = source.startsWith('link ') ? source.slice(5) : undefined;
                const existing = existingBySource.get(source);

                try {
                    if (!existing) {
                        await createMonitoringJob({
                            userId,
                            endpoint: desired.endpoint,
                            source,
                            status: 'initiated',
                            endpointAuth: desired.endpointAuth,
                            acceptedUpStatusCodes: desired.acceptedUpStatusCodes,
                            linkId,
                        });

                        result.created++;
                        result.details.push({ linkId, endpoint: desired.endpoint, userId, action: 'created' });
                        continue;
                    }

                    const endpointChanged = existing.endpoint !== desired.endpoint;
                    const authChanged = String(existing.endpointAuth || '') !== desired.endpointAuth;
                    const upCodesChanged = String(existing.acceptedUpStatusCodes || '') !== desired.acceptedUpStatusCodes;
                    const wasDisabled = existing.status === 'disabled';

                    if (endpointChanged || authChanged || upCodesChanged || wasDisabled) {
                        const updatePayload: Record<string, any> = {
                            endpoint: desired.endpoint,
                            endpointAuth: desired.endpointAuth,
                            acceptedUpStatusCodes: desired.acceptedUpStatusCodes,
                        };

                        if (wasDisabled) {
                            updatePayload.status = 'initiated';
                        }

                        await updateMonitoringJob(existing.id, updatePayload);

                        result.updated++;
                        result.details.push({ linkId, endpoint: desired.endpoint, userId, action: 'updated' });
                    } else {
                        result.skipped++;
                        result.details.push({ linkId, endpoint: desired.endpoint, userId, action: 'exists' });
                    }
                } catch (innerErr: any) {
                    result.errors++;
                    result.details.push({ linkId, endpoint: desired.endpoint, userId, action: 'error', error: innerErr?.message || String(innerErr) });
                }
            }

            for (const job of existingJobs) {
                const source = String(job.source || '');
                if (!source.startsWith('link ')) continue;
                if (desiredJobsBySource.has(source)) continue;
                if (job.status === 'disabled') {
                    result.skipped++;
                    result.details.push({ userId, linkId: source.slice(5), endpoint: job.endpoint, action: 'already_disabled' });
                    continue;
                }

                try {
                    await updateMonitoringJob(job.id, { status: 'disabled' });
                    result.disabled++;
                    result.details.push({ userId, linkId: source.slice(5), endpoint: job.endpoint, action: 'disabled' });
                } catch (disableErr: any) {
                    result.errors++;
                    result.details.push({ userId, linkId: source.slice(5), endpoint: job.endpoint, action: 'error', error: disableErr?.message || String(disableErr) });
                }
            }
        }
    } catch (err: any) {
        result.errors++;
        result.details.push({ action: 'fatal', error: err?.message || String(err) });
    }
    console.log(result);
    return result;
}

/**
 * For a given userId, generate missing IDs for links in their userConfig
 */
export async function generateMissingLinkIds(userId: string): Promise<{
    updatedLinks: number;
    details: Array<{ linkIndex: number; oldId?: string; newId: string }>;
}> {
    const result = { updatedLinks: 0, details: [] as any[] };

    try {
        // fetch userConfig for this user
        const userConfigs = await getUserConfigsByAssociatedUserId(userId, 1000);

        if (!userConfigs.length) {
            return result; // no config found
        }

        for (const userConfig of userConfigs) {
            let config: any;
            try {
                config = parseConfigObject(userConfig.config);
            } catch {
                continue; // skip invalid JSON
            }

            if (!Array.isArray(config.links)) continue;

            let updated = false;

            config.links.forEach((link: any, idx: number) => {
                if (!link.id) {
                    const newId = generateId(10);
                    result.details.push({ linkIndex: idx, oldId: link.id, newId });
                    link.id = newId;
                    updated = true;
                    result.updatedLinks++;
                }
            });

            // save updated config back to PocketBase
            if (updated) {
                await updateUserConfigRecord(userConfig.id, {
                    config,
                });
            }
        }
    } catch (err: any) {
        console.error("Error generating missing link IDs:", err.message || err);
    }
    
    return result;
}

// helper to generate random id
function generateId(length = 8) {
    return Math.random().toString(36).substr(2, length);
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

function serializeStatusCheckAuth(raw: unknown): string {
    if (!raw) return '';

    let auth: any = raw;
    if (typeof raw === 'string') {
        try {
            auth = JSON.parse(raw);
        } catch {
            return '';
        }
    }

    if (!auth || typeof auth !== 'object') return '';

    if (auth.type === 'bearer' && typeof auth.token === 'string' && auth.token.trim()) {
        return JSON.stringify({ type: 'bearer', token: auth.token.trim() });
    }
    if (auth.type === 'basic' && typeof auth.username === 'string' && auth.username.trim()) {
        return JSON.stringify({ type: 'basic', username: auth.username.trim(), password: typeof auth.password === 'string' ? auth.password : '' });
    }
    if (auth.type === 'header' && typeof auth.name === 'string' && auth.name.trim()) {
        return JSON.stringify({ type: 'header', name: auth.name.trim(), value: typeof auth.value === 'string' ? auth.value : '' });
    }

    return '';
}

function serializeAcceptedStatusCodes(rawCodes: unknown): string {
    if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
        return JSON.stringify([200, 201, 202, 204, 301, 302, 304]);
    }

    const normalized = rawCodes
        .map((entry) => Number(entry))
        .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599);

    const unique = Array.from(new Set(normalized));
    if (unique.length === 0) {
        return JSON.stringify([200, 201, 202, 204, 301, 302, 304]);
    }

    return JSON.stringify(unique);
}
