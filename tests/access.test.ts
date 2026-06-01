import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/server/access';
import { signCookie, verifyCookie, isAllowlisted, ACCESS_COOKIE } from '../src/lib/server/access';

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

describe('access cookie', () => {
  // sessionSecret() reads SESSION_SECRET from env first (see secrets store),
  // so set it deterministically for the test.
  process.env.SESSION_SECRET = 'test-session-secret';

  it('verifies a freshly signed cookie', () => {
    expect(verifyCookie(signCookie())).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const good = signCookie();
    const tampered = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
    expect(verifyCookie(tampered)).toBe(false);
  });

  it('rejects undefined / malformed cookies', () => {
    expect(verifyCookie(undefined)).toBe(false);
    expect(verifyCookie('garbage')).toBe(false);
  });

  it('exposes a stable cookie name', () => {
    expect(ACCESS_COOKIE).toBe('home_access');
  });
});

describe('isAllowlisted', () => {
  it('allows unlock and setup routes', () => {
    expect(isAllowlisted('/unlock')).toBe(true);
    expect(isAllowlisted('/api/unlock')).toBe(true);
    expect(isAllowlisted('/setup')).toBe(true);
    expect(isAllowlisted('/api/setup')).toBe(true);
  });
  it('allows framework assets', () => {
    expect(isAllowlisted('/_app/immutable/chunk.js')).toBe(true);
    expect(isAllowlisted('/service-worker.js')).toBe(true);
    expect(isAllowlisted('/favicon.png')).toBe(true);
  });
  it('gates application routes', () => {
    expect(isAllowlisted('/')).toBe(false);
    expect(isAllowlisted('/tasks')).toBe(false);
    expect(isAllowlisted('/api/maintenance/tasks')).toBe(false);
  });
});
