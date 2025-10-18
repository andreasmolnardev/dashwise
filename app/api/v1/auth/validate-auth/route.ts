import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
   const pb = getServerPB();

        // --- 1. Require Bearer auth
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        pb.authStore.save(token, null);

        // refresh to validate and get user id
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id ?? null;

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json({"success": true}, {status: 200})

  } catch (err) {
    console.error('Validation error:', err);
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
