import { NextResponse } from 'next/server';
import { createRoom, RoomCapacityError } from '../../../server/rooms';
import { checkRateLimit } from '../../../server/rate-limit';
import { RATE_LIMIT } from '../../../lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fly는 Fly-Client-IP를 신뢰 가능한 실 클라이언트 IP로 채움. 그 뒤로 X-Forwarded-For
// 첫 홉, 둘 다 없으면 'unknown'(로컬·직접 접속)으로 폴백.
function clientIp(req: Request): string {
  const fly = req.headers.get('fly-client-ip');
  if (fly) return fly;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export async function POST(req: Request) {
  // IP별 방 생성 레이트리밋은 프로덕션에서만 — 개발·LAN QR 테스트는 통과.
  if (process.env.NODE_ENV === 'production') {
    const { ok, retryAfterSec } = checkRateLimit(
      `room:${clientIp(req)}`,
      RATE_LIMIT.ROOM_CREATE_WINDOW_MS,
      RATE_LIMIT.ROOM_CREATE_MAX,
      Date.now(),
    );
    if (!ok) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      );
    }
  }

  try {
    const { roomId, hostToken } = createRoom();
    return NextResponse.json({ roomId, hostToken });
  } catch (err) {
    if (err instanceof RoomCapacityError) {
      return NextResponse.json({ error: 'room_capacity' }, { status: 503 });
    }
    throw err;
  }
}
