import { config } from "../config/env";
import { getSuperuserPB } from "../lib/pb";
import { monitorHelper } from "./helper";

export async function runStatusMonitoringJobs(): Promise<{
    processed: number;
    skipped: number;
    updated: number;
    logsCreated: number;
    errors: number;
    details: Array<any>;
}> {
    const adminPb = await getSuperuserPB();
    const result = { processed: 0, skipped: 0, updated: 0, logsCreated: 0, errors: 0, details: [] as any[] };

    console.log("running status monitoring jobs");

    // fetch all monitoring jobs (increase limit if you expect >2000)
    const jobs = await adminPb.collection('monitoringJobs').getFullList(2000);

    for (const job of jobs) {
        const endpoint = job.endpoint;
        if (!endpoint) {
            result.skipped++;
            result.details.push({ jobId: job.id, action: 'skipped', reason: 'no endpoint' });
            continue;
        }

        // optionally skip truly disabled jobs
        if (job.status === 'disabled') {
            result.skipped++;
            result.details.push({ jobId: job.id, action: 'skipped', reason: 'disabled' });
            continue;
        }

        result.processed++;

        try {
            const code = await monitorHelper(endpoint, config.ALLOW_SSL === 'true');
            const newStatus = (code >= 200 && code < 400) ? 'healthy' : 'unhealthy';

            if (newStatus !== job.status) {
                // update job
                await adminPb.collection('monitoringJobs').update(job.id, { status: newStatus });

                // create log — relation field expects array of related ids in PocketBase
                await adminPb.collection('monitoringJobStatusLogs').create({
                    job: [job.id],
                    status: newStatus,
                });

                result.updated++;
                result.logsCreated++;
                result.details.push({ jobId: job.id, oldStatus: job.status, newStatus, httpStatus: code });
            } else {
                result.details.push({ jobId: job.id, action: 'no_change', status: job.status, httpStatus: code });
            }
        } catch (err: any) {
            // network/fetch error -> mark unhealthy and log if it represents a state change
            result.errors++;
            result.details.push({ jobId: job.id, action: 'fetch_error', error: err?.message || String(err) });

            try {
                if (job.status !== 'unhealthy') {
                    await adminPb.collection('monitoringJobs').update(job.id, { status: 'unhealthy' });
                    await adminPb.collection('monitoringJobStatusLogs').create({
                        job: [job.id],
                        status: 'unhealthy',
                    });
                    result.updated++;
                    result.logsCreated++;
                    result.details.push({ jobId: job.id, oldStatus: job.status, newStatus: 'unhealthy', note: 'network/fetch error' });
                }
            } catch (uerr: any) {
                result.errors++;
                result.details.push({ jobId: job.id, action: 'update_error', error: uerr?.message || String(uerr) });
            }
        }
    }

    console.log("runStatusMonitoringJobs result:", result);
    return result;
}
