import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

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
