import type { OAuth2AccessToken } from './types';

export type AuthManagerOpts = {
  refresh: (refreshToken: string) => Promise<OAuth2AccessToken>;
  reauth: () => Promise<OAuth2AccessToken>;
  persist: (s: { refreshToken: string }) => void;
  getStored: () => { refreshToken: string | null };
};

export function createAuthManager(opts: AuthManagerOpts) {
  let cached: { token: string; expiresAt: number } | null = null;

  async function obtainNew(): Promise<OAuth2AccessToken> {
    const stored = opts.getStored();
    if (stored.refreshToken) {
      try {
        return await opts.refresh(stored.refreshToken);
      } catch {
        return await opts.reauth();
      }
    }
    return await opts.reauth();
  }

  async function getValidToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const t = await obtainNew();
    opts.persist({ refreshToken: t.refresh_token });
    cached = {
      token: t.access_token,
      expiresAt: Date.now() + Math.floor(t.expires_in * 1000 * 0.75),
    };
    return t.access_token;
  }

  function invalidate() { cached = null; }

  return { getValidToken, invalidate };
}
