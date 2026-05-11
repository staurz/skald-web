import type { OAuth2AccessToken, ValidateUserResponse, AuthenticationSpa } from './types';

// REG_SITE hosts /api/auth (credential validation + salt), confirmed in WebServerService.java.
// API_SERVER hosts /access_token (OAuth grant + refresh), confirmed in AccessServerService.java.
const REG_SITE = 'https://myarcticspa.com';
const API_SERVER = 'https://api.myarcticspa.com';
const OAUTH_CLIENT_ID = 'mqtt-mobile';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function validateUser(email: string, password: string): Promise<ValidateUserResponse> {
  return postJson<ValidateUserResponse>(`${REG_SITE}/api/auth`, { Username: email, Password: password });
}

export type GrantArgs = {
  email: string;
  passwordHash: string;
  spa: AuthenticationSpa;
  userId?: string | null;
};

export async function grantToken(args: GrantArgs): Promise<OAuth2AccessToken> {
  const spaIdLower = args.spa.Id.toLowerCase();
  const username = `${args.email}|${spaIdLower}`;
  return postJson<OAuth2AccessToken>(`${API_SERVER}/access_token`, {
    grant_type: 'password',
    client_id: OAUTH_CLIENT_ID,
    username,
    password: args.passwordHash,
    spa: args.spa,
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuth2AccessToken> {
  return postJson<OAuth2AccessToken>(`${API_SERVER}/access_token`, {
    grant_type: 'refresh_token',
    client_id: OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
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
