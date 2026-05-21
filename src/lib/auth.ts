import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { cookies, headers } from 'next/headers';
import { getDb } from '@/lib/db';
import {
  encodeSession,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  type SessionStatus,
} from '@/lib/session-token';

// ---------------------------------------------------------------------------
// SESSION_SECRET bootstrap
// ---------------------------------------------------------------------------

function ensureSessionSecret(): void {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  let body = '';
  try {
    body = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  } catch {
    return;
  }
  if (/^SESSION_SECRET=/m.test(body)) {
    const m = body.match(/^SESSION_SECRET=(.*)$/m);
    if (m) process.env.SESSION_SECRET = m[1].trim();
    return;
  }
  const secret = randomBytes(48).toString('base64url');
  const newBody = (body && !body.endsWith('\n') ? body + '\n' : body) + `SESSION_SECRET=${secret}\n`;
  try {
    fs.writeFileSync(envPath, newBody, { mode: 0o600 });
    process.env.SESSION_SECRET = secret;
    console.log('[auth] generated SESSION_SECRET and wrote it to .env.local');
  } catch (err) {
    console.warn('[auth] could not persist SESSION_SECRET to .env.local:', err);
    process.env.SESSION_SECRET = secret;
  }
}
ensureSessionSecret();

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

// Mirror the request scheme so cookies aren't dropped on HTTP-only deploys —
// browsers refuse to send Secure cookies over plain HTTP.
async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || '';
  if (proto) return proto.split(',')[0].trim() === 'https';
  return (h.get('host') || '').endsWith(':443');
}

export async function setSessionCookieFor(user: UserRow): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const token = await encodeSession({
    uid: user.id,
    username: user.github_login,
    status: user.status,
    is_admin: !!user.is_admin,
    avatar_url: user.avatar_url,
    exp,
  });
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttpsRequest(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttpsRequest(),
    path: '/',
    maxAge: 0,
  });
}

export async function getSessionFromCookies() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export { SESSION_COOKIE_NAME };

// ---------------------------------------------------------------------------
// User CRUD (GitHub-backed)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  github_id: string;
  github_login: string;
  avatar_url: string | null;
  status: SessionStatus;
  is_admin: number; // 0/1 — sqlite has no booleans
  created_at: string;
  last_login_at: string | null;
  approved_at: string | null;
  approved_by_id: number | null;
}

function adminLogins(): Set<string> {
  const raw = process.env.ADMIN_GITHUB_LOGINS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isLoginAutoAdmin(login: string): boolean {
  return adminLogins().has(login.toLowerCase());
}

/**
 * Look up by GitHub numeric ID; if missing, insert; on every call, refresh
 * the cached login/avatar (in case the user renamed on GitHub) and bump
 * last_login_at.
 *
 * ADMIN_GITHUB_LOGINS is bootstrap-only: it grants admin + approved at the
 * very first insert. After that, role and status live in the DB and are
 * managed via the admin UI — env changes never re-promote, re-demote, or
 * re-approve an existing user.
 */
export function upsertGithubUser(input: {
  github_id: string;
  github_login: string;
  avatar_url: string | null;
}): UserRow {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT * FROM users WHERE github_id = ?')
    .get(input.github_id) as UserRow | undefined;

  if (!existing) {
    const isAdmin = isLoginAutoAdmin(input.github_login);
    const info = db
      .prepare(
        `INSERT INTO users (github_id, github_login, avatar_url, status, is_admin, created_at, last_login_at, approved_at)
         VALUES (?, ?, ?, 'approved', ?, ?, ?, ?)`,
      )
      .run(
        input.github_id,
        input.github_login,
        input.avatar_url,
        isAdmin ? 1 : 0,
        now,
        now,
        now,
      );
    return getUserById(Number(info.lastInsertRowid))!;
  }

  // Backfill: any user still flagged 'pending' from the old approval flow gets
  // promoted on their next login. 'rejected' users stay rejected — that's the
  // admin-ban path and must remain gated by middleware.
  if (existing.status === 'pending') {
    db.prepare(
      `UPDATE users
         SET github_login = ?, avatar_url = ?, last_login_at = ?,
             status = 'approved', approved_at = COALESCE(approved_at, ?)
       WHERE id = ?`,
    ).run(input.github_login, input.avatar_url, now, now, existing.id);
  } else {
    db.prepare(
      `UPDATE users
         SET github_login = ?, avatar_url = ?, last_login_at = ?
       WHERE id = ?`,
    ).run(input.github_login, input.avatar_url, now, existing.id);
  }
  return getUserById(existing.id)!;
}

export function getUserById(id: number): UserRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
}

export function listUsers(): UserRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[];
}

// ---------------------------------------------------------------------------
// Role management (admin <-> regular user)
// ---------------------------------------------------------------------------

export class RoleError extends Error {
  constructor(
    public code: 'not_found' | 'self_demote' | 'last_admin',
    message: string,
  ) {
    super(message);
    this.name = 'RoleError';
  }
}

export function countAdmins(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin = 1').get() as { c: number }).c;
}

export function approveUser(id: number, approvedById: number): UserRow | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET status = 'approved', approved_at = ?, approved_by_id = ? WHERE id = ?`,
  ).run(now, approvedById, id);
  return getUserById(id);
}

export function rejectUser(id: number, approvedById: number): UserRow | null {
  const target = getUserById(id);
  if (!target) return null;
  if (id === approvedById) throw new RoleError('self_demote', 'You cannot reject yourself');
  if (target.is_admin && countAdmins() <= 1)
    throw new RoleError('last_admin', 'Cannot reject the last admin');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET status = 'rejected', approved_at = ?, approved_by_id = ? WHERE id = ?`,
  ).run(now, approvedById, id);
  return getUserById(id);
}

export function userCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
}

export function pendingCount(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) c FROM users WHERE status = 'pending'").get() as { c: number }).c;
}

export function recentPendingUsers(limit = 20): UserRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?")
    .all(limit) as UserRow[];
}

/**
 * Grant the admin role. Idempotent. If the target isn't yet approved, this
 * also approves them — admin implies approved everywhere else in the app.
 */
export function promoteUser(id: number, byId: number): UserRow {
  const db = getDb();
  const target = getUserById(id);
  if (!target) throw new RoleError('not_found', 'User not found');
  if (target.is_admin && target.status === 'approved') return target;
  const now = new Date().toISOString();
  if (target.status !== 'approved') {
    db.prepare(
      `UPDATE users
         SET is_admin = 1,
             status = 'approved',
             approved_at = COALESCE(approved_at, ?),
             approved_by_id = COALESCE(approved_by_id, ?)
       WHERE id = ?`,
    ).run(now, byId, id);
  } else {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
  }
  return getUserById(id)!;
}

/**
 * Revoke the admin role. Idempotent. Refuses to demote the caller themselves
 * or the last remaining admin.
 */
export function demoteUser(id: number, byId: number): UserRow {
  const target = getUserById(id);
  if (!target) throw new RoleError('not_found', 'User not found');
  if (id === byId) throw new RoleError('self_demote', 'You cannot demote yourself');
  if (!target.is_admin) return target;
  if (countAdmins() <= 1) throw new RoleError('last_admin', 'Cannot demote the last admin');
  const db = getDb();
  db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(id);
  return getUserById(id)!;
}
