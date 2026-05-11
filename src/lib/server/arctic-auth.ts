import { hashPassword } from './hasher';
import type { OAuth2AccessToken, ValidateUserResponse, AuthenticationSpa } from './types';

// REG_SITE hosts /api/auth (credential validation + salt), confirmed in WebServerService.java.
// API_SERVER hosts /access_token (OAuth grant + refresh), confirmed in AccessServerService.java.
const REG_SITE = 'https://myarcticspa.com';
const API_SERVER = 'https://api.myarcticspa.com';

// Hard-coded in the production APK (CoreRequest, prod flavor). The OAuth server requires it
// alongside client_id; without it /access_token returns invalid_client.
const PROD_CLIENT_SECRET = '@4EUu^Y:U+FGtt2P';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Single POST to /api/auth.
 *
 * `hash` is omitted on round 1 (the APK passes null and Gson drops the field). The
 * server returns the salt for the user; the client then re-POSTs with hash filled in.
 */
export async function validateUser(username: string, hash: string | null): Promise<ValidateUserResponse> {
  const body: Record<string, unknown> = { username, AllowNoSpaLogin: true };
  if (hash !== null) body.hash = hash;
  return postJson<ValidateUserResponse>(`${REG_SITE}/api/auth`, body);
}

export type AuthenticateResult = {
  userId: string | null;
  salt: string;
  passwordHash: string;
  spas: AuthenticationSpa[];
};

/**
 * Two-call /api/auth dance, matching LoginFragment.Authenticate:
 *   1. POST { username, AllowNoSpaLogin: true } (no hash) → get back Salt
 *   2. POST { username, hash: SHA1(salt || utf16le-password), AllowNoSpaLogin: true } → get back UserId + Spas
 */
export async function authenticate(username: string, password: string): Promise<AuthenticateResult> {
  const round1 = await validateUser(username, null);
  if (round1.ErrorCode != null) throw new Error(authErrorLabel(round1.ErrorCode, 'round 1'));
  if (!round1.Salt) throw new Error('round 1 returned no salt — unexpected response shape');

  const passwordHash = hashPassword(password, round1.Salt);
  const round2 = await validateUser(username, passwordHash);
  // ErrorCode 3 (NO_SPAS_FOUND) is tolerable: the account is valid but has no spa associated.
  if (round2.ErrorCode != null && round2.ErrorCode !== 3) {
    throw new Error(authErrorLabel(round2.ErrorCode, 'round 2'));
  }

  return {
    userId: round2.UserId ?? round1.UserId ?? null,
    salt: round1.Salt,
    passwordHash,
    spas: round2.Spas ?? [],
  };
}

function authErrorLabel(code: number, stage: string): string {
  const map: Record<number, string> = {
    1: 'USER_NOT_FOUND',
    2: 'NO_USER_SPECIFIED',
    3: 'NO_SPAS_FOUND',
    4: 'NOT_AUTHENTICATED',
  };
  return `validateUser ${stage} ErrorCode=${code} (${map[code] ?? 'UNKNOWN'})`;
}

/**
 * Client-id suffix matches SharedPreferencesManager.getCachedClientID: it picks
 * `aws-iot-mobile` when the spa has been migrated, `mqtt-mobile` for legacy spas,
 * and `no-spa-user` when the account has no spa. The installation-id suffix is per
 * deployment.
 */
export function clientIdFor(spa: AuthenticationSpa | null, installationId: string): string {
  if (!spa) return `no-spa-user_${installationId}`;
  if (spa.IsMoved === true) return `aws-iot-mobile_${installationId}`;
  return `mqtt-mobile_${installationId}`;
}

export type GrantArgs = {
  username: string;
  passwordHash: string;
  spa: AuthenticationSpa;
  installationId: string;
  userId?: string | null;
};

export async function grantToken(args: GrantArgs): Promise<OAuth2AccessToken> {
  const spaIdLower = args.spa.Id.toLowerCase();
  const composite = `${args.username}|${spaIdLower}`;
  return postJson<OAuth2AccessToken>(`${API_SERVER}/access_token`, {
    grant_type: 'password',
    client_id: clientIdFor(args.spa, args.installationId),
    client_secret: PROD_CLIENT_SECRET,
    username: composite,
    password: args.passwordHash,
    spa: args.spa,
    scope: 'basic',
  });
}

export type RefreshArgs = {
  refreshToken: string;
  installationId: string;
  spa?: AuthenticationSpa | null;
};

export async function refreshAccessToken(args: RefreshArgs): Promise<OAuth2AccessToken> {
  return postJson<OAuth2AccessToken>(`${API_SERVER}/access_token`, {
    grant_type: 'refresh_token',
    client_id: clientIdFor(args.spa ?? null, args.installationId),
    client_secret: PROD_CLIENT_SECRET,
    refresh_token: args.refreshToken,
  });
}

/** Decode a JWT's payload without verification — we only need the `sub` claim (the spa UUID). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function spaUuidFromJwt(jwt: string): string | null {
  const p = decodeJwtPayload(jwt);
  return typeof p?.sub === 'string' ? p.sub : null;
}
