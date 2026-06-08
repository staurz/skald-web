import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
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

describe('weather-trigger columns', () => {
  it('fresh db has weather_trigger (default 0) and last_weather_fired_ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wx-'));
    const db = openDb(join(dir, 'fresh.db'));
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('weather_trigger');
    expect(cols).toContain('last_weather_fired_ts');
  });

  it('migrates a pre-existing db that lacks the columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wx-old-'));
    const path = join(dir, 'old.db');
    const raw = new Database(path);
    raw.exec(`CREATE TABLE maintenance_task (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, recurrence_kind TEXT NOT NULL,
      interval_value INTEGER, interval_unit TEXT, annual_month INTEGER, annual_day INTEGER,
      due_ts INTEGER, last_completed_ts INTEGER, last_reminded_ts INTEGER, enabled INTEGER NOT NULL DEFAULT 1
    )`);
    raw.close();
    const db = openDb(path); // must not throw
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('weather_trigger');
    expect(cols).toContain('last_weather_fired_ts');
  });
});
