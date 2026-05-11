import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateUser, grantToken, refreshAccessToken } from '../src/lib/server/arctic-auth';

beforeEach(() => {
  vi.restoreAllMocks();
});

const fakeFetch = (responses: Array<{ status: number; body: unknown }>) => {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
};

describe('validateUser', () => {
  it('POSTs to /api/auth and returns Salt/UserId/Spas', async () => {
    const f = fakeFetch([{ status: 200, body: { ErrorCode: 0, Salt: 'c2FsdA==', UserId: 'user-1', Spas: [{ Id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NickName: 'Mine', IsConnected: true, IsMoved: null, DealerId: 0 }] } }]);
    vi.stubGlobal('fetch', f);
    const r = await validateUser('user@example.com', 'pw');
    expect(f).toHaveBeenCalledWith(
      'https://api.myarcticspa.com/api/auth',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ Username: 'user@example.com', Password: 'pw' }) }),
    );
    expect(r.Salt).toBe('c2FsdA==');
    expect(r.Spas[0].Id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});

describe('grantToken', () => {
  it('POSTs grant_type=password with composite username and persisted hash', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.X.Y', refresh_token: 'rt-1', expires_in: 3600, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    const t = await grantToken({
      email: 'user@example.com',
      passwordHash: 'hashhash',
      spa: { Id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', NickName: 'Mine', IsConnected: true, IsMoved: null, DealerId: 0 },
    });
    expect(f).toHaveBeenCalledWith(
      'https://api.myarcticspa.com/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('password');
    expect(body.username).toBe('user@example.com|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body.password).toBe('hashhash');
    expect(body.spa.Id).toBe('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');
    expect(t.access_token).toBe('JWT.X.Y');
    expect(t.expires_in).toBe(3600);
  });
});

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.A.B', refresh_token: 'rt-2', expires_in: 1800, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    const t = await refreshAccessToken('rt-1');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('refresh_token');
    expect(body.refresh_token).toBe('rt-1');
    expect(t.access_token).toBe('JWT.A.B');
    expect(t.refresh_token).toBe('rt-2');
  });
});
