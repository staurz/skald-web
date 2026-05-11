import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateUser,
  authenticate,
  grantToken,
  refreshAccessToken,
  clientIdFor,
} from '../src/lib/server/arctic-auth';
import { hashPassword } from '../src/lib/server/hasher';
import type { AuthenticationSpa } from '../src/lib/server/types';

beforeEach(() => {
  vi.restoreAllMocks();
});

const fakeFetch = (responses: Array<{ status: number; body: unknown }>) => {
  let i = 0;
  return vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
    const r = responses[i++];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
};

const legacySpa: AuthenticationSpa = {
  Id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
  NickName: 'Mine',
  IsConnected: true,
  IsMoved: false,
  DealerId: 0,
};

const movedSpa: AuthenticationSpa = { ...legacySpa, IsMoved: true, DealerId: 42 };

describe('validateUser', () => {
  it('POSTs {username, hash, AllowNoSpaLogin} when hash is provided', async () => {
    const f = fakeFetch([{ status: 200, body: { ErrorCode: 0, Salt: 'c2FsdA==' } }]);
    vi.stubGlobal('fetch', f);
    const r = await validateUser('emil', 'somehash');
    expect(f).toHaveBeenCalledWith(
      'https://myarcticspa.com/api/auth',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'emil', AllowNoSpaLogin: true, hash: 'somehash' }),
      }),
    );
    expect(r.Salt).toBe('c2FsdA==');
  });

  it('omits the hash field entirely when hash is null', async () => {
    const f = fakeFetch([{ status: 200, body: { ErrorCode: null, Salt: 'c2FsdA==' } }]);
    vi.stubGlobal('fetch', f);
    await validateUser('emil', null);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ username: 'emil', AllowNoSpaLogin: true });
    expect('hash' in body).toBe(false);
  });
});

describe('authenticate', () => {
  it('does the two-call dance: round1 → salt, round2 → UserId+Spas', async () => {
    const salt = 'c2FsdHkyMDI2';
    const expectedHash = hashPassword('secret', salt);
    const f = fakeFetch([
      { status: 200, body: { ErrorCode: null, Salt: salt } },
      { status: 200, body: { ErrorCode: null, UserId: 'user-1', Spas: [legacySpa] } },
    ]);
    vi.stubGlobal('fetch', f);

    const out = await authenticate('emil', 'secret');

    expect(f).toHaveBeenCalledTimes(2);
    const body1 = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(body1).toEqual({ username: 'emil', AllowNoSpaLogin: true });
    expect('hash' in body1).toBe(false);
    expect(body2).toEqual({ username: 'emil', AllowNoSpaLogin: true, hash: expectedHash });

    expect(out.userId).toBe('user-1');
    expect(out.salt).toBe(salt);
    expect(out.passwordHash).toBe(expectedHash);
    expect(out.spas).toHaveLength(1);
    expect(out.spas[0].Id).toBe(legacySpa.Id);
  });

  it('tolerates ErrorCode=3 (NO_SPAS_FOUND) on round 2', async () => {
    const f = fakeFetch([
      { status: 200, body: { ErrorCode: null, Salt: 'c2FsdA==' } },
      { status: 200, body: { ErrorCode: 3 } },
    ]);
    vi.stubGlobal('fetch', f);
    const out = await authenticate('emil', 'pw');
    expect(out.spas).toEqual([]);
  });

  it('throws on round 1 ErrorCode (e.g. USER_NOT_FOUND=1)', async () => {
    const f = fakeFetch([{ status: 200, body: { ErrorCode: 1 } }]);
    vi.stubGlobal('fetch', f);
    await expect(authenticate('nobody', 'pw')).rejects.toThrow(/USER_NOT_FOUND/);
  });

  it('throws on round 2 ErrorCode other than 3 (e.g. NOT_AUTHENTICATED=4)', async () => {
    const f = fakeFetch([
      { status: 200, body: { ErrorCode: null, Salt: 'c2FsdA==' } },
      { status: 200, body: { ErrorCode: 4 } },
    ]);
    vi.stubGlobal('fetch', f);
    await expect(authenticate('emil', 'wrong')).rejects.toThrow(/NOT_AUTHENTICATED/);
  });
});

describe('clientIdFor', () => {
  it('returns no-spa-user_<install> when spa is null', () => {
    expect(clientIdFor(null, 'inst-1')).toBe('no-spa-user_inst-1');
  });
  it('returns mqtt-mobile_<install> for legacy (IsMoved=false)', () => {
    expect(clientIdFor(legacySpa, 'inst-1')).toBe('mqtt-mobile_inst-1');
  });
  it('returns aws-iot-mobile_<install> for migrated (IsMoved=true)', () => {
    expect(clientIdFor(movedSpa, 'inst-1')).toBe('aws-iot-mobile_inst-1');
  });
});

describe('grantToken', () => {
  it('POSTs grant_type=password with composite username, client_secret, scope=basic, dynamic client_id', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.X.Y', refresh_token: 'rt-1', expires_in: 3600, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);

    const t = await grantToken({
      username: 'emil',
      passwordHash: 'hashhash',
      spa: legacySpa,
      installationId: 'inst-1',
      userId: 'user-1',
    });

    expect(f).toHaveBeenCalledWith(
      'https://api.myarcticspa.com/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('password');
    expect(body.client_id).toBe('mqtt-mobile_inst-1');
    expect(body.client_secret).toBe('@4EUu^Y:U+FGtt2P');
    expect(body.scope).toBe('basic');
    expect(body.username).toBe('emil|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body.password).toBe('hashhash');
    expect(body.spa.Id).toBe(legacySpa.Id);
    expect(t.access_token).toBe('JWT.X.Y');
    expect(t.expires_in).toBe(3600);
  });

  it('uses aws-iot-mobile client_id when spa.IsMoved is true', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    await grantToken({ username: 'emil', passwordHash: 'h', spa: movedSpa, installationId: 'inst-1' });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.client_id).toBe('aws-iot-mobile_inst-1');
  });
});

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token with client_id/secret', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT.A.B', refresh_token: 'rt-2', expires_in: 1800, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);

    const t = await refreshAccessToken({ refreshToken: 'rt-1', installationId: 'inst-1', spa: legacySpa });

    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.grant_type).toBe('refresh_token');
    expect(body.refresh_token).toBe('rt-1');
    expect(body.client_id).toBe('mqtt-mobile_inst-1');
    expect(body.client_secret).toBe('@4EUu^Y:U+FGtt2P');
    expect(t.access_token).toBe('JWT.A.B');
    expect(t.refresh_token).toBe('rt-2');
  });

  it('falls back to no-spa-user client_id when spa is omitted', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'JWT', refresh_token: 'rt', expires_in: 1800, token_type: 'bearer' } }]);
    vi.stubGlobal('fetch', f);
    await refreshAccessToken({ refreshToken: 'rt-1', installationId: 'inst-1' });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.client_id).toBe('no-spa-user_inst-1');
  });
});
