import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';

export async function DELETE(request: Request) {
  try {
    const { email, password, totp } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const pb = getServerPB();

    // Re-authenticate the user
    const authData = await pb.collection('users').authWithPassword(email, password);
    const user = authData.record;

    // If 2FA is enabled on the user, require and verify the TOTP code
    if (user.totpSecret) {
      if (!totp) {
        return NextResponse.json({ error: 'TOTP code required because 2FA is enabled' }, { status: 401 });
      }

      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: totp,
        window: 1,
      });

      if (!verified) {
        return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 401 });
      }
    }

    // Attempt to delete the user's record
    await pb.collection('users').delete(user.id);

    // Clear server-side auth store if present to avoid leaving a stale session
    try { pb.authStore.clear(); } catch (e) { /* ignore if not available */ }

    // 204 No Content indicates successful deletion
    return new NextResponse(null, { status: 204 });

  } catch (err) {
    console.error('Delete account error:', err);

    // If PocketBase returns a permission error, surface that specifically
    const message = (err && (err as any).status === 403)
      ? 'Not allowed to delete this account (check collection Delete rule / permissions)'
      : 'Unable to delete account';

    return NextResponse.json({ error: message }, { status: (err && (err as any).status) || 500 });
  }
}
