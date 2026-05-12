import type Database from 'better-sqlite3';

const FIVE_MIN = 5 * 60 * 1000;

type Extractor = {
  metric: string;
  topicSuffix: string;
  field: string;
  transform?: (v: number) => number;
};

// Field names match the real telemetry shapes — see tests/fixtures/spa-payloads.ts
// and payload-normalisers.ts. spaboy.ph is centi-pH; divide so rollups carry the
// real pH value (avg/min/max are then directly comparable to the dashboard card).
const METRIC_EXTRACTORS: Extractor[] = [
  { metric: 'temperatureF', topicSuffix: '/telemetry/spa', field: 'tempF' },
  { metric: 'targetTemperatureF', topicSuffix: '/telemetry/spa', field: 'tempSetPointF' },
  { metric: 'ph', topicSuffix: '/telemetry/spaboy', field: 'ph', transform: (v) => v / 100 },
  { metric: 'orp', topicSuffix: '/telemetry/spaboy', field: 'orp' },
];

export function rollupBucket(db: Database.Database, ts: number) {
  const bucket = Math.floor(ts / FIVE_MIN) * FIVE_MIN;
  const start = bucket;
  const end = bucket + FIVE_MIN;

  const upsert = db.prepare(`
    INSERT INTO metric_5m (metric, ts_bucket, avg, min, max, sample_count)
    VALUES (@metric, @bucket, @avg, @min, @max, @count)
    ON CONFLICT (metric, ts_bucket) DO UPDATE SET
      avg = @avg, min = @min, max = @max, sample_count = @count
  `);
  const fetch = db.prepare('SELECT payload_json FROM events WHERE ts >= ? AND ts < ? AND topic LIKE ?');

  for (const e of METRIC_EXTRACTORS) {
    const rows = fetch.all(start, end, `%${e.topicSuffix}`) as { payload_json: string }[];
    const values: number[] = [];
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload_json);
        const raw = p[e.field];
        if (typeof raw === 'number') values.push(e.transform ? e.transform(raw) : raw);
      } catch {
        /* skip malformed */
      }
    }
    if (values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    upsert.run({ metric: e.metric, bucket, avg, min, max, count: values.length });
  }
}

export function startRollupLoop(db: Database.Database) {
  // Roll up the bucket that just finished, every minute. Idempotent — the
  // upsert overwrites the bucket row if more samples land before it closes.
  return setInterval(() => rollupBucket(db, Date.now() - FIVE_MIN), 60_000);
}
