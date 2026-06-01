import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { defaultSecrets } from '$lib/server/secrets';
import { ACCESS_COOKIE, signCookie, verifyPassword } from '$lib/server/access';

const TEN_YEARS_SEC = 60 * 60 * 24 * 365 * 10;

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { password } = (await request.json()) as { password?: string };
  const stored = defaultSecrets.get('SITE_PASSWORD_HASH');
  if (!stored) throw error(400, 'No site password configured');
  if (!password || !verifyPassword(password, stored)) {
    throw error(401, 'Wrong password');
  }
  cookies.set(ACCESS_COOKIE, signCookie(), {
    path: '/',
    httpOnly: true,
    // `secure` is intentionally omitted: SvelteKit defaults it to true in
    // production but relaxes it for http://localhost, so dev unlock works.
    sameSite: 'lax',
    maxAge: TEN_YEARS_SEC,
  });
  return json({ ok: true });
};
