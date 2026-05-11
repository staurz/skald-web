import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecretsStore } from '../src/lib/server/secrets';

describe('SecretsStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'secrets-')); });

  it('returns null for unset keys', () => {
    const s = createSecretsStore({ filePath: join(dir, 'secrets.json'), env: {} });
    expect(s.get('ARCTIC_PASSWORD_HASH')).toBeNull();
  });

  it('persists and reads back values', () => {
    const f = join(dir, 'secrets.json');
    const s1 = createSecretsStore({ filePath: f, env: {} });
    s1.set('ARCTIC_PASSWORD_HASH', 'abc');
    const s2 = createSecretsStore({ filePath: f, env: {} });
    expect(s2.get('ARCTIC_PASSWORD_HASH')).toBe('abc');
  });

  it('env vars take precedence over file', () => {
    const f = join(dir, 'secrets.json');
    const s = createSecretsStore({ filePath: f, env: { ARCTIC_PASSWORD_HASH: 'fromEnv' } });
    s.set('ARCTIC_PASSWORD_HASH', 'fromFile');
    expect(s.get('ARCTIC_PASSWORD_HASH')).toBe('fromEnv');
  });
});
