import { NextRequest, NextResponse } from 'next/server';
import config from '@/lib/config';
import axios from 'axios';
import { authenticateUserId, getUserNewsFeedRecord } from '../_shared';

export async function POST(request: NextRequest) {
    if (!config.jobs_webhook_enabled) {
        return NextResponse.json({ message: "Jobs webhook is disabled" }, { status: 400 });
    }

    try {
        const userId = await authenticateUserId(request);
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userFeedRecord = await getUserNewsFeedRecord(userId);
        if (!userFeedRecord?.id) {
            return NextResponse.json({ message: "No subscriptions found for user" }, { status: 200 });
        }

        const feedId = userFeedRecord.id;
        const url = `${config.jobs_url}/webhook/newsFeedBuilder${feedId ? `?feedId=${feedId}` : ''}`;
        const response = await axios.get(url);
        return NextResponse.json(response.data);
    } catch (error: any) {
        console.error("Error triggering news feed refresh:", error);
        return NextResponse.json({ 
            error: error.response?.data || error.message,
            status: error.response?.status || 500
        }, { status: error.response?.status || 500 });
    }
}

export async function GET(request: NextRequest) {
    return POST(request);
}
