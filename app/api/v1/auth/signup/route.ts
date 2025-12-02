import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import config from '@/lib/config';

export async function POST(request: Request) {
    try {
        if (config.disableUserSignup) {
           return new NextResponse(JSON.stringify({ error: 'Signup failed.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            }); 
        }
        const { name, email, password, passwordConfirm } = await request.json();

        if (!email || !password || !passwordConfirm) {
            return new NextResponse(JSON.stringify({ error: 'All fields are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (password !== passwordConfirm) {
            return new NextResponse(JSON.stringify({ error: 'Passwords do not match' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // using localpart of email as fallback
        let newName;
        if (name === "" || !name && typeof email === "string") {
            const localPart = email.split("@")[0];
            // a little transformation can't be missing
            newName = localPart
                .replace(/[._-]+/g, ' ')
                .trim()
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) // capitalize
                .join(' ');
        } else {
            newName = name;
        }

        const pb = getServerPB();

        // 1. Create the user
        const user = await pb.collection('users').create({
            newName,
            email,
            password,
            passwordConfirm,
        });

        // 2. Load the default config from /public
        const configPath = path.join(process.cwd(), 'public', 'default-config.json');
        const configFile = await fs.readFile(configPath, 'utf-8');
        const configJson = JSON.parse(configFile);

        // 3. Create a new row in userConfig
        await pb.collection('userConfig').create({
            associatedUserId: user.id,
            config: configJson,
        });

        return NextResponse.json({ user }, { status: 201 });
    } catch (err) {
        console.error('Signup error:', err);
        return new Response(JSON.stringify({ error: 'Signup failed - internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
