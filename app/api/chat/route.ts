import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// POST /api/chat — a viewer sends a chat message
export async function POST(req: NextRequest) {
  const { username, content } = await req.json().catch(() => ({}));
  const author = String(username ?? '').trim().slice(0, 30) || 'viewer';
  const text = String(content ?? '').trim().slice(0, 500);
  if (!text) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { error } = await db.from('messages').insert({ channel: 'chat', author, content: text });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
