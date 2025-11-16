import { getBookmarks } from '@/lib/clients/karakeep/client';
import config from '@/lib/config';
import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import { AuthModel, ClientResponseError } from 'pocketbase';

export async function GET(request: Request) {
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

        const configRecord = await pb.collection('userConfig').getFirstListItem(
            `associatedUserId="${authModel.record.id}"`
        );

        //  decode API credentials
        const apiToken = Buffer.from(configRecord.config.integrations.Karakeep.api_token, "base64").toString("utf8");
        const serverLocation = Buffer.from(configRecord.config.integrations.Karakeep.server_location, "base64").toString("utf8");

        const bookmarks = await getBookmarks({ serverUrl: serverLocation, token: apiToken, allowInsecureCerts: config.allowInsecureCertsForIntegrationUrls ? true : false})

        const url = new URL(request.url);
        const latestParam = url.searchParams.get("latest");

        if (latestParam !== null) {
            const latest = [...(bookmarks ?? [])]
                .sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )
                .slice(0, 10);

            return NextResponse.json({ latest: latest, serverDetails: { url: serverLocation } }, { status: 200 });
        }

        // full list mapped
        return NextResponse.json({ bookmarks, serverDetails: { url: serverLocation } }, { status: 200 });


    } catch (error) {
        console.error('Error fetching config:', error);
        return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }
}
