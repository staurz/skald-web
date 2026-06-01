import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/server/access';

describe('password hashing', () => {
  it('verifies the correct password', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct horse', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('battery staple', stored)).toBe(false);
  });

  it('produces a distinct salt each call (no rainbow reuse)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects a malformed stored value without throwing', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
