import { getSuperuserPB } from "../lib/pb";

export default async function indexStatusMonitoringJobs(): Promise<{
    created: number;
    skipped: number;
    errors: number;
    details: Array<{ linkId?: string; endpoint?: string; userId?: string; action: string; error?: string }>;
}> {
    const adminPb = await getSuperuserPB();
    const result = { created: 0, skipped: 0, errors: 0, details: [] as any[] };

    console.log("indexing monitoring jobs")

    try {
        // fetch all user configs
        const userConfigs = await adminPb.collection('userConfig').getFullList(1000);

        for (const userConfig of userConfigs) {
            const userId = userConfig.associatedUserId;

            if (!userId) {
                result.skipped++;
                result.details.push({ action: 'skipped', error: 'userConfig without associatedUserId', linkId: userConfig.id });
                continue;
            }

            await generateMissingLinkIds(userId)

            let configLinks: any[] = [];
            try {
                configLinks = userConfig.config.links?.filter((l: any) => l.statusCheck === true) || [];
            } catch (parseErr: any) {
                result.errors++;
                result.details.push({ action: 'error', error: 'Failed to parse userConfig.config', linkId: userConfig.id });
                continue;
            }

            for (const link of configLinks) {
                const endpoint = link.url;
                if (!endpoint) {
                    result.skipped++;
                    result.details.push({ linkId: link.id, userId, action: 'skipped', error: 'no url in link' });
                    continue;
                }

                try {
                    // check if monitoring job already exists for this user/endpoint/source
                    const existenceFilter = `source = "link ${link.id}"`;
                    const existing = await adminPb.collection('monitoringJobs').getList(1, 1, { filter: existenceFilter });

                    if (existing.totalItems > 0) {
                        result.skipped++;
                        result.details.push({ linkId: link.id, endpoint, userId, action: 'exists' });
                        continue;
                    }

                    // create monitoring job
                    await adminPb.collection('monitoringJobs').create({
                        userId,
                        endpoint,
                        source: 'link ' + link.id,
                        status: 'initiated',
                        linkId: link.id,
                    });

                    result.created++;
                    result.details.push({ linkId: link.id, endpoint, userId, action: 'created' });
                } catch (innerErr: any) {
                    result.errors++;
                    result.details.push({ linkId: link.id, endpoint, userId, action: 'error', error: innerErr?.message || String(innerErr) });
                }
            }
        }
    } catch (err: any) {
        result.errors++;
        result.details.push({ action: 'fatal', error: err?.message || String(err) });
    }
    console.log(result)
    return result;
}

/**
 * For a given userId, generate missing IDs for links in their userConfig
 */
export async function generateMissingLinkIds(userId: string): Promise<{
    updatedLinks: number;
    details: Array<{ linkIndex: number; oldId?: string; newId: string }>;
}> {
    const adminPb = await getSuperuserPB();
    const result = { updatedLinks: 0, details: [] as any[] };

    try {
        // fetch userConfig for this user
        const userConfigs = await adminPb.collection('userConfig').getFullList(1000, {
            filter: `associatedUserId = "${userId}"`,
        });

        if (!userConfigs.length) {
            return result; // no config found
        }

        for (const userConfig of userConfigs) {
            let config: any;
            try {
                config = userConfig.config || '{}';
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
                await adminPb.collection('userConfig').update(userConfig.id, {
                    config: JSON.stringify(config),
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
