import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import { rollupBucket } from '../src/lib/server/history';
import { TELEMETRY_SPA, TELEMETRY_SPABOY } from './fixtures/spa-payloads';

type MetricRow = {
  metric: string;
  ts_bucket: number;
  avg: number;
  min: number;
  max: number;
  sample_count: number;
};

describe('rollupBucket', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-'));
  });

  it('aggregates tempF samples into a single metric_5m row for the bucket', () => {
    const db = openDb(join(dir, 'h.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const t0 = 1_700_000_100_000; // exact 5-min boundary so all three inserts land in one bucket
    ins.run(t0, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 100 }));
    ins.run(t0 + 60_000, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 102 }));
    ins.run(t0 + 120_000, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 104 }));

    rollupBucket(db, t0);
    const rows = db.prepare('SELECT * FROM metric_5m WHERE metric = ?').all('temperatureF') as MetricRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].avg).toBeCloseTo(102, 1);
    expect(rows[0].min).toBe(100);
    expect(rows[0].max).toBe(104);
    expect(rows[0].sample_count).toBe(3);
  });

  it('divides centi-pH by 100 when rolling up ph', () => {
    const db = openDb(join(dir, 'ph.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const t0 = 1_700_000_100_000; // exact 5-min boundary so all three inserts land in one bucket
    ins.run(t0, 'arctic/spa/u/telemetry/spaboy', JSON.stringify({ ...TELEMETRY_SPABOY, ph: 720 }));
    ins.run(t0 + 60_000, 'arctic/spa/u/telemetry/spaboy', JSON.stringify({ ...TELEMETRY_SPABOY, ph: 780 }));

    rollupBucket(db, t0);
    const rows = db.prepare('SELECT * FROM metric_5m WHERE metric = ?').all('ph') as MetricRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].min).toBeCloseTo(7.20, 2);
    expect(rows[0].max).toBeCloseTo(7.80, 2);
    expect(rows[0].avg).toBeCloseTo(7.50, 2);
  });

  it('rolls up ORP without scaling and writes a separate metric row', () => {
    const db = openDb(join(dir, 'orp.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const t0 = 1_700_000_100_000; // exact 5-min boundary so all three inserts land in one bucket
    ins.run(t0, 'arctic/spa/u/telemetry/spaboy', JSON.stringify({ ...TELEMETRY_SPABOY, orp: 600 }));
    ins.run(t0 + 60_000, 'arctic/spa/u/telemetry/spaboy', JSON.stringify({ ...TELEMETRY_SPABOY, orp: 700 }));

    rollupBucket(db, t0);
    const rows = db.prepare('SELECT * FROM metric_5m WHERE metric = ?').all('orp') as MetricRow[];
    expect(rows[0].min).toBe(600);
    expect(rows[0].max).toBe(700);
  });

  it('idempotent: re-running the rollup updates the bucket row in place', () => {
    const db = openDb(join(dir, 'idem.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const t0 = 1_700_000_100_000; // exact 5-min boundary so all three inserts land in one bucket
    ins.run(t0, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 100 }));
    rollupBucket(db, t0);
    ins.run(t0 + 60_000, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 110 }));
    rollupBucket(db, t0);

    const rows = db.prepare('SELECT * FROM metric_5m WHERE metric = ?').all('temperatureF') as MetricRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].sample_count).toBe(2);
    expect(rows[0].max).toBe(110);
  });

  it('skips metrics with no samples in the bucket', () => {
    const db = openDb(join(dir, 'empty.db'));
    rollupBucket(db, 1_700_000_000_000);
    const rows = db.prepare('SELECT count(*) AS c FROM metric_5m').get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it('aligns bucket to a 5-minute boundary regardless of input ts', () => {
    const db = openDb(join(dir, 'bucket.db'));
    const ins = db.prepare('INSERT INTO events (ts, topic, payload_json) VALUES (?, ?, ?)');
    const bucketStart = 1_700_000_100_000; // exact 5-min boundary
    ins.run(bucketStart + 90_000, 'arctic/spa/u/telemetry/spa', JSON.stringify({ ...TELEMETRY_SPA, tempF: 99 }));

    rollupBucket(db, bucketStart + 180_000); // mid-bucket ts
    const rows = db.prepare('SELECT ts_bucket FROM metric_5m').all() as { ts_bucket: number }[];
    expect(rows[0].ts_bucket).toBe(bucketStart);
  });
});
