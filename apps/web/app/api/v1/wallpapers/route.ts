import { getServerPB } from '@dashwise/sdk/lib/pocketbase';
import { getWallpaperByFileName, uploadWallpaper } from '@dashwise/sdk/data/wallpapers';
import { NextResponse } from 'next/server';

async function authenticateFromHeader(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const token = authHeader.split(' ')[1];
    const pb = getServerPB();
    pb.authStore.save(token, null);

    const authModel = await pb.collection('users').authRefresh();
    if (!authModel) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    return { pb, token, authModel };
}

export async function POST(request: Request) {
    try {
        const auth = await authenticateFromHeader(request);
        if ((auth as any).error) return (auth as any).error;
        const { token } = auth as { token: string };

        const formData = await request.formData();
        const result = await uploadWallpaper(token, formData);

        return NextResponse.json(result);

    } catch (err) {
        console.error('Error uploading wallpaper:', err);
        return NextResponse.json({ error: 'Failed to upload wallpaper' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    try {
        const auth = await authenticateFromHeader(request);
        if ((auth as any).error) return (auth as any).error;
        const { token } = auth as { token: string };

        const url = new URL(request.url);
        const fileName = url.searchParams.get('fileName');
        if (!fileName) {
            return NextResponse.json({ error: 'Missing query parameter: fileName' }, { status: 400 });
        }

        const wallpaper = await getWallpaperByFileName(token, fileName);
        if (!wallpaper) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return new NextResponse(wallpaper.buffer, {
            headers: {
                'Content-Type': wallpaper.contentType,
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (err) {
        console.error('Error serving wallpaper:', err);
        return NextResponse.json({ error: 'Failed to serve wallpaper' }, { status: 500 });
    }
}
