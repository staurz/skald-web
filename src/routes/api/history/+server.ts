import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { openDb } from '$lib/server/db';

export const GET: RequestHandler = ({ url }) => {
  const metric = url.searchParams.get('metric');
  if (!metric) throw error(400, 'metric required');

  const fromMs = Number(url.searchParams.get('from') ?? Date.now() - 24 * 3600 * 1000);
  const toMs = Number(url.searchParams.get('to') ?? Date.now());

  const db = openDb();
  const rows = db
    .prepare(
      'SELECT ts_bucket, avg, min, max, sample_count FROM metric_5m WHERE metric = ? AND ts_bucket >= ? AND ts_bucket <= ? ORDER BY ts_bucket',
    )
    .all(metric, fromMs, toMs);
  return json({ metric, points: rows });
};
