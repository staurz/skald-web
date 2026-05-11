import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SecretKey =
  | 'ARCTIC_USERNAME'
  | 'ARCTIC_USER_ID'
  | 'ARCTIC_SPA_UUID'
  | 'ARCTIC_PASSWORD_HASH'
  | 'ARCTIC_REFRESH_TOKEN'
  | 'INSTALLATION_ID'
  | 'VAPID_PUBLIC_KEY'
  | 'VAPID_PRIVATE_KEY';

export interface SecretsStore {
  get(key: SecretKey): string | null;
  set(key: SecretKey, value: string): void;
  delete(key: SecretKey): void;
}

export function createSecretsStore(opts: { filePath: string; env: NodeJS.ProcessEnv }): SecretsStore {
  const { filePath, env } = opts;

  function readFile(): Record<string, string> {
    if (!existsSync(filePath)) return {};
    try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return {}; }
  }
  function writeFile(data: Record<string, string>) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    get(key) {
      const fromEnv = env[key];
      if (fromEnv && fromEnv.length > 0) return fromEnv;
      const data = readFile();
      return data[key] ?? null;
    },
    set(key, value) {
      const data = readFile();
      data[key] = value;
      writeFile(data);
    },
    delete(key) {
      const data = readFile();
      delete data[key];
      writeFile(data);
    },
  };
}

export const defaultSecrets = createSecretsStore({
  filePath: process.env.SECRETS_FILE ?? './data/secrets.json',
  env: process.env,
});
