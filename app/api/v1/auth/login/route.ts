import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';

export async function POST(request: Request) {
  try {
    const { email, password, totp } = await request.json();

    if (!email || !password) {
      return new NextResponse(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pb = getServerPB();

    // Authenticate user with email and password
    const authData = await pb.collection('users').authWithPassword(email, password);
    const user = authData.record;

    // Check if user has 2FA enabled
    if (user.totpSecret) {
      if (!totp) {
        return NextResponse.json(
          { error: 'TOTP code required because 2FA is enabled' },
          { status: 401 }
        );
      }

      // Verify TOTP
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: totp,
        window: 1, // allow 1 step before/after to account for clock drift
      });

      if (!verified) {
        return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 401 });
      }
    }

    // Return token and user info if everything passes
    return NextResponse.json(
      {
        token: authData.token,
        user,
      },
      { status: 200 }
    );

  } catch (err) {
    console.error('Login error:', err);
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
