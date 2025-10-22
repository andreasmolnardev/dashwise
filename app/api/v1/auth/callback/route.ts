import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import config from '@/lib/config';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
        return NextResponse.json({ error: 'Invalid OAuth callback parameters' }, { status: 400 });
    }

    const pb = getServerPB();

    try {
        // Finish OAuth with PocketBase
        const authData = await pb
            .collection('users')
            .authWithOAuth2Code('oidc2', code, state, `${process.env.NEXT_PUBLIC_BASE_URL}/api/v1/auth/callback`);

        const user = authData.record;

        // --- Check if userConfig exists ---
        const configs = await pb.collection('userConfig').getFullList({
            filter: `associatedUserId="${user.id}"`,
        });

        if (configs.length === 0) {
            // Load default config and create one
            const configPath = path.join(process.cwd(), 'public', 'default-config.json');
            const configFile = await fs.readFile(configPath, 'utf-8');
            const configJson = JSON.parse(configFile);

            await pb.collection('userConfig').create({
                associatedUserId: user.id,
                config: configJson,
            });
        }

        // --- Store auth token as a cookie so client can move it to localStorage ---
        const response = NextResponse.redirect(`${config.app_base_url}/home`);
        response.cookies.set('pb_token', authData.token, {
            httpOnly: false,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });

        return response;
    } catch (err: any) {
        console.error('OAuth error:', err.response || err);
        return NextResponse.json({ error: 'OAuth login failed' }, { status: 401 });
    }
}
