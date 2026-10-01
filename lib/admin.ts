import { createHash, timingSafeEqual } from 'crypto';

// Checks the owner password (ADMIN_PASSWORD in Vercel). Returns an error message, or null if OK.
export function checkAdminPassword(given: unknown): { error: string; status: number } | null {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { error: 'ADMIN_PASSWORD is not set in Vercel', status: 503 };
  if (typeof given !== 'string') return { error: 'Wrong password', status: 401 };
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(hash(given), hash(expected))) return { error: 'Wrong password', status: 401 };
  return null;
}
