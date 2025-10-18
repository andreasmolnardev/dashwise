import { getServerPB } from "@/lib/pb";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    // 1. authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const pb = getServerPB();
    pb.authStore.save(token, null);
    const authModel = await pb.collection('users').authRefresh();
    if (!authModel) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. parse query + body
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    if (!path) {
      return NextResponse.json(
        { error: 'Missing query parameter: path' },
        { status: 400 }
      );
    }   

    const { src, dst } = await request.json();
    if (typeof src !== 'number' || typeof dst !== 'number') {
      return NextResponse.json(
        { error: 'Both "src" and "dst" must be numbers' },
        { status: 400 }
      );
    }

    // 3. fetch config
    const record = await pb
      .collection('userConfig')
      .getFirstListItem(`associatedUserId="${authModel.record.id}"`);

    const config = record.config as Record<string, any>;
    if (!Array.isArray(config[path])) {
      return NextResponse.json(
        { error: `Config key "${path}" is not an array` },
        { status: 400 }
      );
    }

    // 4. move item inside array
    const arr = config[path];
    if (src < 0 || src >= arr.length || dst < 0 || dst >= arr.length) {
      return NextResponse.json(
        { error: 'src or dst index out of bounds' },
        { status: 400 }
      );
    }

    const [movedItem] = arr.splice(src, 1);
    arr.splice(dst, 0, movedItem);

    // 5. persist back
    await pb
      .collection('userConfig')
      .update(record.id, { config });

    return NextResponse.json({
      success: true,
      updatedPath: path,
      movedItem,
      newArray: arr,
    });
  } catch (err) {
    console.error('Error moving array items:', err);
    return NextResponse.json(
      { error: 'Failed to move array items' },
      { status: 500 }
    );
  }
}
