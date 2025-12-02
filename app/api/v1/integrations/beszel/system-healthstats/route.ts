import { getBeszelMetrics, getBeszelSystemHealth } from '@/lib/clients/beszel/client';
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
        const serverLocation = Buffer.from(configRecord.config.integrations.Beszel.server_location, "base64").toString("utf8");
        const pbAdminEmail = Buffer.from(configRecord.config.integrations.Beszel.pb_email, "base64").toString("utf8");
        const pbAdminPassword = Buffer.from(configRecord.config.integrations.Beszel.pb_password, "base64").toString("utf8");

        console.log(serverLocation)

        const metrics = await getBeszelSystemHealth(
            {url: serverLocation, pb_email: pbAdminEmail, pb_password: pbAdminPassword, allowInsecureCerts: config.allowInsecureCertsForIntegrationUrls}
        )

        // full list mapped
        return NextResponse.json(metrics, { status: 200 });


    } catch (error) {
        console.error('Error fetching beszel metrics:', error);
        return NextResponse.json({ error: 'Failed to fetch beszel metrics' }, { status: 500 });
    }
}
