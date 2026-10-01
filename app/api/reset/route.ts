import { NextRequest, NextResponse } from 'next/server';
import { getDb, savePicture } from '@/lib/db';
import { checkAdminPassword } from '@/lib/admin';

// POST /api/reset — { password } — owner only: clears the bot conversation so it restarts from "Hi."
// The current drawing is saved to the gallery first. Viewer chat is kept.
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const denied = checkAdminPassword(password);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  // Keep the drawing: save it to the gallery before wiping the conversation (skipped if empty)
  await savePicture(db, 'Saved before starting over');

  const { error } = await db.from('messages').delete().eq('channel', 'bots');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
