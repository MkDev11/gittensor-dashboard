import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionFromCookies, getUserById } from '@/lib/auth';
import type { UserRepo } from '@/types/entities';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const sess = await getSessionFromCookies();
  if (!sess) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const me = getUserById(sess.uid);
  if (!me || !me.is_admin) return { error: NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 }) };
  return { error: null as null };
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare('SELECT full_name, weight, notes, added_at FROM user_repos ORDER BY added_at DESC')
    .all() as UserRepo[];
  return NextResponse.json({ count: rows.length, repos: rows });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.full_name !== 'string') {
    return NextResponse.json({ error: 'full_name required' }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(body.full_name)) {
    return NextResponse.json({ error: 'full_name must be in owner/repo format' }, { status: 400 });
  }
  const weight = typeof body.weight === 'number' ? Math.max(0, Math.min(1, body.weight)) : 0.01;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 200) : null;

  const db = getDb();
  db.prepare(
    `INSERT INTO user_repos (full_name, weight, notes, added_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(full_name) DO UPDATE SET weight=excluded.weight, notes=excluded.notes`
  ).run(body.full_name, weight, notes, new Date().toISOString());

  return NextResponse.json({ ok: true, full_name: body.full_name, weight, notes });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const fullName = url.searchParams.get('full_name');
  if (!fullName) return NextResponse.json({ error: 'full_name required' }, { status: 400 });

  const db = getDb();
  const r = db.prepare('DELETE FROM user_repos WHERE full_name = ?').run(fullName);
  return NextResponse.json({ ok: true, deleted: r.changes });
}
