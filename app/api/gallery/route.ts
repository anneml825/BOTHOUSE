import { NextRequest, NextResponse } from 'next/server';
import { getDb, isMissingTable, savePicture } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// GET /api/gallery — saved drawings, newest first
export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data, error } = await db
    .from('drawings')
    .select('id, title, shapes, created_at')
    .order('id', { ascending: false })
    .limit(60);
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ setup: 'drawings', drawings: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ drawings: data ?? [] });
}

// POST /api/gallery — { title } — saves the current canvas
export async function POST(req: NextRequest) {
  const { title } = await req.json().catch(() => ({}));

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const problem = await savePicture(db, String(title ?? '').trim());
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  return NextResponse.json({ ok: true });
}
