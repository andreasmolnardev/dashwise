import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    enableSSO: process.env.NEXT_PUBLIC_ENABLE_SSO === "1" || process.env.NEXT_PUBLIC_ENABLE_SSO === "true"
  });
}
