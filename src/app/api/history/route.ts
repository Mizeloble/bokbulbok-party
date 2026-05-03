import { clearAll } from '../../../server/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE() {
  clearAll();
  return new Response(null, { status: 204 });
}
