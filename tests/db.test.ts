import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

describe('openDb', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'db-')); });

  it('creates the schema if missing', () => {
    const db = openDb(join(dir, 'spa.db'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('events');
    expect(names).toContain('metric_5m');
    expect(names).toContain('accessory_runtime');
    expect(names).toContain('alert_rule');
    expect(names).toContain('alert_event');
    expect(names).toContain('push_subscription');
  });

  it('appends events', () => {
    const db = openDb(join(dir, 'spa.db'));
    db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)').run(1000, 'arctic/spa/x/telemetry/spa', '{"a":1}');
    const r = db.prepare('SELECT count(*) as n FROM events').get() as { n: number };
    expect(r.n).toBe(1);
  });
});
