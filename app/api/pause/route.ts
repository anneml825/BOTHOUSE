import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, PAUSED_UNTIL } from '@/lib/db';

function passwordMatches(given: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(given), hash(expected));
}

// POST /api/pause — { password, paused } — only the owner (ADMIN_PASSWORD) can pause or resume
export async function POST(req: NextRequest) {
  const { password, paused } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD is not set in Vercel' }, { status: 503 });
  }
  if (typeof password !== 'string' || !passwordMatches(password)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { error } = await db
    .from('turn_lock')
    .update({ locked_until: paused ? PAUSED_UNTIL : new Date().toISOString() })
    .eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paused: !!paused });
}
