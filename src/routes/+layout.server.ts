import { redirect } from '@sveltejs/kit';
import { defaultSecrets } from '$lib/server/secrets';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
  const configured = !!defaultSecrets.get('ARCTIC_PASSWORD_HASH');
  if (!configured && !url.pathname.startsWith('/setup') && !url.pathname.startsWith('/api/setup')) {
    throw redirect(307, '/setup');
  }
  return {};
};
