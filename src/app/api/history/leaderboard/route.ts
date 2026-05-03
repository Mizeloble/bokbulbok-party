import { NextResponse } from 'next/server';
import { getLeaderboard } from '../../../../server/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = getLeaderboard(50);
  return NextResponse.json({ rows });
}
