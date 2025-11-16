// File: app/api/version-check/route.ts (or .js)

import { NextResponse } from 'next/server';
import { getServerPB, getSuperuserPB } from '@/lib/pb';
import config from '@/lib/config';

export async function GET() {
  const instanceName = "dashwise";

  try {
    let record;
    const pb = getServerPB();
    try {
      // Fetch the specific record for this instance.
      record = await pb.collection("appInfo").getFirstListItem(
        `instanceName = "${instanceName.toLowerCase()}"`
      );
    } catch (err: any) {
      if (err.status === 404) {
        return NextResponse.json(
          {
            error: "App info record not found. The comparison runner may not have run yet."
          },
          { status: 404 }
        );
      }
      // Re-throw any other database connection errors
      throw err;
    }

    // Return the data stored in the database
    return NextResponse.json({
      updateAvailable: record.updateAvailable,
      currentAppVersion: config.version,
    });

  } catch (err: any) {
    console.error("Failed to fetch app info:", err);
    return NextResponse.json(
      { error: "Failed to fetch app info from database", details: err.message },
      { status: 500 }
    );
  }
}