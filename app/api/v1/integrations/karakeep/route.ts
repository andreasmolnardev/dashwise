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
        const apiToken = Buffer.from(configRecord.api_token, "base64").toString("utf8");
        const serverLocation = Buffer.from(configRecord.server_location, "base64").toString("utf8");


        // NEW — fetch bookmarks
        const res = await fetch(`${serverLocation}/api/v1/bookmarks`, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
        });

        if (!res.ok) {
            return NextResponse.json(
                { error: "Failed to fetch bookmarks" },
                { status: res.status }
            );
        }

        const bookmarks = await res.json();

        return NextResponse.json({ bookmarks }, { status: 200 });


    } catch (error) {
        console.error('Error fetching config:', error);
        return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }
}
