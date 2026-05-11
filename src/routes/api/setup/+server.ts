import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { hashPassword } from '$lib/server/hasher';
import { validateUser, grantToken, spaUuidFromJwt } from '$lib/server/arctic-auth';
import { defaultSecrets } from '$lib/server/secrets';

export const POST: RequestHandler = async ({ request }) => {
  const { email, password } = await request.json() as { email: string; password: string };
  if (!email || !password) throw error(400, 'email and password required');

  const validation = await validateUser(email, password);
  if (validation.ErrorCode && validation.ErrorCode !== 0) throw error(401, `validateUser ErrorCode=${validation.ErrorCode}`);
  if (!validation.Salt) throw error(401, 'no salt returned — credentials likely invalid');
  if (!validation.Spas || validation.Spas.length === 0) throw error(404, 'no spa associated with this account');

  const spa = validation.Spas[0]; // single-spa assumption for v1
  const passwordHash = hashPassword(password, validation.Salt);

  const token = await grantToken({ email, passwordHash, spa, userId: validation.UserId });
  const spaUuid = spaUuidFromJwt(token.access_token) ?? spa.Id;

  defaultSecrets.set('ARCTIC_USERNAME', email);
  defaultSecrets.set('ARCTIC_USER_ID', validation.UserId ?? '');
  defaultSecrets.set('ARCTIC_SPA_UUID', spaUuid);
  defaultSecrets.set('ARCTIC_PASSWORD_HASH', passwordHash);
  defaultSecrets.set('ARCTIC_REFRESH_TOKEN', token.refresh_token);

  return json({ ok: true, spaUuid, expires_in: token.expires_in });
};
