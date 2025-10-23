import { getServerPB } from '@/lib/pb';
import { NextResponse } from 'next/server';
import { AuthModel, ClientResponseError } from 'pocketbase';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const pb = getServerPB();
    pb.authStore.save(token, null);

    let authModel;

    try {
      authModel = await pb.collection('users').authRefresh();
    } catch (error) {
      if (error instanceof ClientResponseError && error.status === 401) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      throw error;
    }

    const configRecord = await pb.collection('userConfig').getFirstListItem(
      `associatedUserId="${authModel.record.id}"`
    );

    // convert credentials to a boolean list
    // integrations: { karakeep: {...} } -> integrations: { karakeep: true/false }
    const strippedIntegrations = Object.fromEntries(
      Object.entries(configRecord.config.integrations).map(([k, v]) => [
        k,
        // v needs special type checking
        !!v && !Array.isArray(v) &&
        typeof v === "object" &&
        Object.keys(v).length > 0
      ])
    )

    // replace original integrations
    configRecord.config.integrations = strippedIntegrations;

    return NextResponse.json(configRecord.config);
  } catch (error) {
    console.error('Error fetching config:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

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
    const req = await request.json();
    const newItem = req.newItem;

    // 3. fetch & mutate existing config
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
    config[path].push(newItem);

    // 4. persist back to PocketBase
    await pb
      .collection('userConfig')
      .update(record.id, { config });

    return NextResponse.json({
      success: true,
      updatedPath: path,
      newItem,
    });
  } catch (err) {
    console.error('Error updating config:', err);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {

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
    const res = await request.json();
    const newItem = res.updatedItem

    // 3. fetch & mutate existing config
    const record = await pb
      .collection('userConfig')
      .getFirstListItem(`associatedUserId="${authModel.record.id}"`);

    const config = record.config as Record<string, any>;

    config[path] = newItem;

    // 4. persist back to PocketBase
    await pb
      .collection('userConfig')
      .update(record.id, { config });

    return NextResponse.json({
      success: true,
      updatedPath: path,
      newItem,
    });
  } catch (err) {
    console.error('Error updating config:', err);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    // 1) auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const pb = getServerPB();
    pb.authStore.save(token, null);

    let authModel;
    try {
      authModel = await pb.collection('users').authRefresh();
    } catch (error) {
      if (error instanceof ClientResponseError && error.status === 401) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      throw error;
    }

    // 2) body
    const body = await request.json().catch(() => null) as { config?: unknown } | null;
    if (!body || body.config === undefined || body.config === null || typeof body.config !== 'object') {
      return NextResponse.json({ error: 'Body must be { "config": { ... } }' }, { status: 400 });
    }

    // 3) load existing record or create
    let record: any | null = null;
    try {
      record = await pb.collection('userConfig')
        .getFirstListItem(`associatedUserId="${authModel.record.id}"`);
    } catch (e) {
      record = null;
    }

    if (record) {
      await pb.collection('userConfig').update(record.id, { config: body.config });
    } else {
      await pb.collection('userConfig').create({
        associatedUserId: authModel.record.id,
        config: body.config,
      });
    }

    return NextResponse.json({ succes: true });
  } catch (error) {
    console.error("Error replacing config:", error);
    return NextResponse.json({ error: 'Failed to replace config' }, { status: 500 });
  }
}