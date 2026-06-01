import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { authenticate, grantToken, spaUuidFromJwt } from '$lib/server/arctic-auth';
import { defaultSecrets } from '$lib/server/secrets';
import { hashPassword } from '$lib/server/access';

function getOrCreateInstallationId(): string {
  let id = defaultSecrets.get('INSTALLATION_ID');
  if (!id) {
    id = randomUUID();
    defaultSecrets.set('INSTALLATION_ID', id);
  }
  return id;
}

export const POST: RequestHandler = async ({ request }) => {
  const { username, password, sitePassword } = await request.json() as { username: string; password: string; sitePassword?: string };
  if (!username || !password) throw error(400, 'username and password required');

  let stage = 'authenticate';
  try {
    const auth = await authenticate(username, password);
    if (auth.spas.length === 0) throw error(404, 'no spa associated with this account');

    const spa = auth.spas[0]; // single-spa assumption for v1
    const installationId = getOrCreateInstallationId();

    stage = 'grantToken';
    const token = await grantToken({
      username,
      passwordHash: auth.passwordHash,
      spa,
      installationId,
      userId: auth.userId,
    });
    const spaUuid = spaUuidFromJwt(token.access_token) ?? spa.Id;

    stage = 'persistSecrets';
    defaultSecrets.set('ARCTIC_USERNAME', username);
    defaultSecrets.set('ARCTIC_USER_ID', auth.userId ?? '');
    defaultSecrets.set('ARCTIC_SPA_UUID', spaUuid);
    defaultSecrets.set('ARCTIC_PASSWORD_HASH', auth.passwordHash);
    defaultSecrets.set('ARCTIC_REFRESH_TOKEN', token.refresh_token);

    if (typeof sitePassword === 'string' && sitePassword.length > 0) {
      defaultSecrets.set('SITE_PASSWORD_HASH', hashPassword(sitePassword));
    }

    return json({
      ok: true,
      spaUuid,
      expires_in: token.expires_in,
      isMoved: spa.IsMoved,
      mqttPath: spa.IsMoved === true ? 'aws-iot' : 'legacy-tcp',
    });
  } catch (e: any) {
    if (e?.status) throw e;
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error(`[setup] failed at stage ${stage}:`, detail);
    return json({ ok: false, stage, error: detail }, { status: 500 });
  }
};
