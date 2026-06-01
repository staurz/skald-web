import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { defaultSecrets } from './secrets';

const KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, dkHex] = stored.split(':');
  if (!saltHex || !dkHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(dkHex, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const ACCESS_COOKIE = 'home_access';
const COOKIE_TOKEN = 'unlocked';

function sessionSecret(): string {
  let s = defaultSecrets.get('SESSION_SECRET');
  if (!s) {
    s = randomBytes(32).toString('hex');
    defaultSecrets.set('SESSION_SECRET', s);
  }
  return s;
}

export function signCookie(): string {
  const sig = createHmac('sha256', sessionSecret()).update(COOKIE_TOKEN).digest('hex');
  return `${COOKIE_TOKEN}.${sig}`;
}

export function verifyCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [token, sig] = value.split('.');
  if (token !== COOKIE_TOKEN || !sig) return false;
  const expected = createHmac('sha256', sessionSecret()).update(COOKIE_TOKEN).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ALLOW_PREFIXES = ['/unlock', '/api/unlock', '/setup', '/api/setup', '/_app'];
const ALLOW_EXACT = new Set(['/service-worker.js', '/favicon.png', '/favicon.ico', '/manifest.webmanifest', '/robots.txt']);

export function isAllowlisted(pathname: string): boolean {
  if (ALLOW_EXACT.has(pathname)) return true;
  return ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
