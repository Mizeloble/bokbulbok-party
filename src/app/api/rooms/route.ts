import { NextResponse } from 'next/server';
import { createRoom, RoomCapacityError } from '../../../server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
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
