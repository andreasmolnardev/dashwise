import { NextRequest, NextResponse } from 'next/server';
import config from '@/lib/config';
import axios from 'axios';

export async function POST(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const feedId = searchParams.get('feedId');

    if (!config.jobs_webhook_enabled) {
        return NextResponse.json({ message: "Jobs webhook is disabled" }, { status: 400 });
    }

    try {
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
