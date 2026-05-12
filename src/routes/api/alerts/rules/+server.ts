import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import type { AlertRule } from '$lib/server/types';

type Row = { id: string; kind: string; threshold_json: string; enabled: number };

export const GET: RequestHandler = () => {
  const rows = openDb()
    .prepare('SELECT id, kind, threshold_json, enabled FROM alert_rule')
    .all() as Row[];
  const rules: AlertRule[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as AlertRule['kind'],
    threshold: JSON.parse(r.threshold_json),
    enabled: !!r.enabled,
  }));
  return json({ rules });
};

export const PUT: RequestHandler = async ({ request }) => {
  const { rules } = (await request.json()) as { rules: AlertRule[] };
  if (!Array.isArray(rules)) throw error(400, 'rules array required');
  const db = openDb();
  const tx = db.transaction((rs: AlertRule[]) => {
    db.prepare('DELETE FROM alert_rule').run();
    const ins = db.prepare(
      'INSERT INTO alert_rule (id, kind, threshold_json, enabled) VALUES (?, ?, ?, ?)',
    );
    for (const r of rs) ins.run(r.id, r.kind, JSON.stringify(r.threshold), r.enabled ? 1 : 0);
  });
  tx(rules);
  return json({ ok: true });
};
