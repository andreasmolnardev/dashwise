import { getBookmarks, KarakeepSearchItems } from '@/lib/clients/karakeep/client';
import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import { ClientResponseError } from 'pocketbase';

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
        const karakeepConfig = configRecord.config.integrations?.Karakeep;
        const kk_token = Buffer.from(karakeepConfig.api_token, "base64").toString("utf-8");
        const serverUrl = Buffer.from(karakeepConfig.server_location, "base64").toString("utf-8");

        if (!token || !serverUrl) return;

        const bookmarks = await KarakeepSearchItems({ serverUrl, token: kk_token, allowInsecureCerts: true});


        return NextResponse.json(bookmarks);
    } catch (error) {
        console.error('Error fetching config:', error);
        return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }
}
