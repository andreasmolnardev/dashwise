import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import { ClientResponseError } from 'pocketbase';

// Define the structure for the response object
interface JobStatusResponse {
    [jobId: string]: {
        status: string;
        dateChanged: string | null;
        durationChanged: number | null; // Duration in milliseconds
    };
}

export async function GET(request: Request) {
    try {
        // --- auth ---
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const pb = getServerPB();
        pb.authStore.save(token, null);

        let authModel;
        try {
            // Verify the token is valid and get the user record
            authModel = await pb.collection('users').authRefresh();
        } catch (err) {
            if (err instanceof ClientResponseError && err.status === 401) {
                // Token is invalid or expired
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            // Re-throw other errors
            throw err;
        }

        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get('jobId');

        let monitoringJobs;

        if (jobId) {
            monitoringJobs = await pb
                .collection('monitoringJobs')
                .getFullList({
                    filter: `id = "${jobId}" && userId = "${authModel.record.id}"`,
                });

            // If jobId exists but doesn't belong to this user or doesn't exist → return empty
            if (!monitoringJobs || monitoringJobs.length === 0) {
                return NextResponse.json({}, { status: 200 });
            }
        } else {
            monitoringJobs = await pb
                .collection('monitoringJobs')
                .getFullList({
                    filter: `userId = "${authModel.record.id}"`,
                });
        }

        if (!monitoringJobs || monitoringJobs.length === 0) {
            return NextResponse.json({}, { status: 200 });
        }

        // --- Process Jobs and Fetch Logs Iteratively ---
        const results: JobStatusResponse = {};

        for (const job of monitoringJobs) {


            const jobLogsResponse = await pb
                .collection('monitoringJobStatusLogs')
                .getList(1, 2, {
                    filter: `job = "${job.id}" && job.userId = "${authModel.record.id}"`,
                    sort: '-created'
                });


            const jobLogs = jobLogsResponse.items; // this contains the 2 most recent logs

            // Default values
            let latestStatus = job.status; // Default to the job's own status (e.g., 'disabled')
            let dateChanged: string | null = null;
            let durationChanged: number | null = null;

            if (jobLogs && jobLogs.length > 0) {
                // We have at least one log.
                const latestLog = jobLogs[0];

                latestStatus = latestLog.status;
                dateChanged = latestLog.created;


                if (jobLogs.length > 1) {
                    const secondLatestLog = jobLogs[1];

                    const latestDate = new Date(latestLog.created);
                    const secondLatestDate = new Date(secondLatestLog.created);

                    durationChanged = (latestDate.getTime() - secondLatestDate.getTime()) / 1000; //in seconds
                }

            }

            // Add the computed data to our result object
            results[job.source] = {
                status: latestStatus,
                dateChanged: dateChanged,
                durationChanged: durationChanged,
            };
        }

        // Return the latest map
        return NextResponse.json(results, { status: 200 });

    } catch (error) {
        // enhanced logging so PocketBase error payload is visible
        console.error('Error fetching monitoring job statuses:', error);
        try {
            // Log the full PocketBase error response if available
            console.error('error.response:', JSON.stringify((error as any).response, Object.getOwnPropertyNames(error)));
            console.error('error.response?.data:', JSON.stringify((error as any).response?.data));
        } catch (e) {
            console.error('failed to stringify pocketbase error details', e);
        }
        return NextResponse.json({ error: 'Failed to fetch monitoring job statuses' }, { status: 500 });
    }
}