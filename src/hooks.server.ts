import { redirect, type Handle } from '@sveltejs/kit';
import { startBackend } from '$lib/server/boot';
import { defaultSecrets } from '$lib/server/secrets';
import { ACCESS_COOKIE, isAllowlisted, verifyCookie } from '$lib/server/access';

startBackend();

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const gateActive = !!defaultSecrets.get('SITE_PASSWORD_HASH');

  if (gateActive && !isAllowlisted(pathname)) {
    const ok = verifyCookie(event.cookies.get(ACCESS_COOKIE));
    if (!ok) {
      if (pathname.startsWith('/api/')) {
        return new Response('Unauthorized', { status: 401 });
      }
      throw redirect(307, '/unlock');
    }
  }

  return resolve(event);
};
