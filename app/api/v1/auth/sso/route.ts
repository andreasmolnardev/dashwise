import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const provider = new URL(request.url).searchParams.get('provider');
    

    const pb = getServerPB();
    const authMethods = (await pb.collection('users').listAuthMethods()) as any;
    const selected = authMethods.oauth2.providers?.find((p: any) => p.name === provider);
    if (selected) {
        return NextResponse.redirect(selected.authUrl);
    }
    const provider_pocketid = authMethods.oauth2.providers[0];
    if (provider_pocketid) {
        return NextResponse.redirect(provider_pocketid.authUrl);
    }
    return NextResponse.json({ error: 'Provider not available' }, { status: 400 });

}
