import { describe, it, expect, vi } from 'vitest';
import { createAuthManager } from '../src/lib/server/auth-manager';
import type { OAuth2AccessToken } from '../src/lib/server/types';

const token = (over: Partial<OAuth2AccessToken> = {}): OAuth2AccessToken => ({
  access_token: 'jwt',
  refresh_token: 'rt',
  expires_in: 3600,
  token_type: 'bearer',
  ...over,
});

describe('createAuthManager', () => {
  it('uses refresh token to obtain a new access token', async () => {
    const refresh = vi.fn(async () => token({ access_token: 'jwt2', refresh_token: 'rt2' }));
    const reauth = vi.fn(async () => token({ access_token: 'reauth', refresh_token: 'rtR' }));
    const persist = vi.fn();
    const m = createAuthManager({ refresh, reauth, persist, getStored: () => ({ refreshToken: 'rt1' }) });

    const t = await m.getValidToken();
    expect(refresh).toHaveBeenCalledWith('rt1');
    expect(t).toBe('jwt2');
    expect(persist).toHaveBeenCalledWith({ refreshToken: 'rt2' });
    expect(reauth).not.toHaveBeenCalled();
  });

  it('falls back to reauth when refresh fails', async () => {
    const refresh = vi.fn(async () => { throw new Error('400 invalid_grant'); });
    const reauth = vi.fn(async () => token({ access_token: 'reauth', refresh_token: 'rtR' }));
    const persist = vi.fn();
    const m = createAuthManager({ refresh, reauth, persist, getStored: () => ({ refreshToken: 'rt1' }) });

    const t = await m.getValidToken();
    expect(reauth).toHaveBeenCalled();
    expect(t).toBe('reauth');
    expect(persist).toHaveBeenCalledWith({ refreshToken: 'rtR' });
  });

  it('reauths directly when no refresh token is stored', async () => {
    const refresh = vi.fn();
    const reauth = vi.fn(async () => token({ access_token: 'reauth', refresh_token: 'rtR' }));
    const m = createAuthManager({ refresh, reauth, persist: () => {}, getStored: () => ({ refreshToken: null }) });

    const t = await m.getValidToken();
    expect(refresh).not.toHaveBeenCalled();
    expect(reauth).toHaveBeenCalled();
    expect(t).toBe('reauth');
  });

  it('caches the live token until 75% of expiry', async () => {
    const refresh = vi.fn(async () => token({ access_token: 'jwt2', refresh_token: 'rt2', expires_in: 100 }));
    const reauth = vi.fn(async () => { throw new Error('should not be called'); });
    const m = createAuthManager({ refresh, reauth, persist: () => {}, getStored: () => ({ refreshToken: 'rt1' }) });

    const t1 = await m.getValidToken();
    const t2 = await m.getValidToken();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(t1).toBe(t2);
  });

  it('invalidate() forces a refresh on next getValidToken', async () => {
    let n = 0;
    const refresh = vi.fn(async () => token({ access_token: `jwt-${++n}`, refresh_token: `rt-${n}` }));
    const m = createAuthManager({ refresh, reauth: async () => { throw new Error('x'); }, persist: () => {}, getStored: () => ({ refreshToken: 'rt-init' }) });

    const t1 = await m.getValidToken();
    m.invalidate();
    const t2 = await m.getValidToken();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(t1).toBe('jwt-1');
    expect(t2).toBe('jwt-2');
  });
});
