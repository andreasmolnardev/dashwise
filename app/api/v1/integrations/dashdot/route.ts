import getDashdotMetrics from '@/lib/clients/dashdot/client';
import { getBookmarks } from '@/lib/clients/karakeep/client';
import config from '@/lib/config';
import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import { AuthModel, ClientResponseError } from 'pocketbase';

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.split(' ')[1];
        const pb = getServerPB();
        pb.authStore.save(token, null);

        let authModel;

        try {
            authModel = await pb.collection('users').authRefresh();
        } catch (error) {
            if (error instanceof ClientResponseError && error.status === 401) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            throw error;
        }

        const body = await request.json().catch(() => ({}));

        const configRecord = await pb.collection('userConfig').getFirstListItem(
            `associatedUserId="${authModel.record.id}"`
        );

        // take request arguments; default fallback: decode API credentials
        const serverUrl =
            body.serverUrl ??
            Buffer.from(configRecord.config.integrations.Dashdot.server_location, "base64").toString("utf8");

        const displayName =
            body.displayName ??
            Buffer.from(configRecord.config.integrations.Dashdot.server_displayname, "base64").toString("utf8");
        
        // fetch bookmarks
        const metrics = await getDashdotMetrics({ serverUrl, allowInsecureCerts: config.allowInsecureCertsForIntegrationUrls ? true : false })
        
        // full list mapped
        return NextResponse.json({ metrics, serverDetails: { url: serverUrl, displayName } }, { status: 200 });


    } catch (error) {
        console.error('Error fetching metrics:', error);
        return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
    }
}
