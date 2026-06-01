import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The seed is plain ESM (no Vite-only imports), so it is importable as-is.
import { seedMaintenance, ensureSchema, SEED_TASKS } from '../scripts/seed-maintenance.mjs';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'seed-'));
  const db = new Database(join(dir, 'test.db'));
  db.pragma('foreign_keys = ON');
  return db;
}

const FIXED_NOW = Date.parse('2026-06-01T08:00:00Z');

describe('seed-maintenance', () => {
  it('seeds every task with the new descriptive columns populated', () => {
    const db = tempDb();
    const stats = seedMaintenance(db, FIXED_NOW);

    expect(stats.inserted).toBe(SEED_TASKS.length);
    expect(stats.updated).toBe(0);

    const rows = db
      .prepare(`SELECT source, seed_key, description FROM maintenance_task`)
      .all() as { source: string; seed_key: string | null; description: string | null }[];
    expect(rows).toHaveLength(SEED_TASKS.length);
    // Every seeded row carries a seed_key, a known source, and a description.
    const sources = new Set(rows.map((r) => r.source));
    expect([...sources].sort()).toEqual(['from-report', 'gardening', 'general', 'inferred']);
    expect(rows.every((r) => !!r.seed_key)).toBe(true);
    expect(rows.every((r) => !!r.description)).toBe(true);
  });

  it('is idempotent: re-running updates in place without duplicating', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);
    const countAfterFirst = (db.prepare(`SELECT COUNT(*) AS c FROM maintenance_task`).get() as { c: number }).c;
    const subsAfterFirst = (db.prepare(`SELECT COUNT(*) AS c FROM sub_task`).get() as { c: number }).c;

    const stats2 = seedMaintenance(db, FIXED_NOW + 86_400_000);

    expect(stats2.inserted).toBe(0);
    expect(stats2.updated).toBe(SEED_TASKS.length);
    expect(stats2.subTasksAdded).toBe(0); // sub-tasks not re-created
    const countAfterSecond = (db.prepare(`SELECT COUNT(*) AS c FROM maintenance_task`).get() as { c: number }).c;
    const subsAfterSecond = (db.prepare(`SELECT COUNT(*) AS c FROM sub_task`).get() as { c: number }).c;
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(subsAfterSecond).toBe(subsAfterFirst);
  });

  it('preserves user progress (due_ts and checklist ticks) on re-seed', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);

    // Simulate the user completing/rescheduling a task and ticking a checklist item.
    const task = db.prepare(`SELECT id, due_ts FROM maintenance_task WHERE seed_key = ?`).get('report-vatromssjekk') as {
      id: string;
      due_ts: number | null;
    };
    db.prepare(`UPDATE maintenance_task SET due_ts = ?, last_completed_ts = ? WHERE id = ?`).run(
      999_999_999_999,
      FIXED_NOW,
      task.id,
    );
    const sub = db.prepare(`SELECT id FROM sub_task WHERE parent_id = ? LIMIT 1`).get(task.id) as { id: string };
    db.prepare(`UPDATE sub_task SET done = 1 WHERE id = ?`).run(sub.id);

    seedMaintenance(db, FIXED_NOW + 86_400_000);

    const after = db.prepare(`SELECT due_ts, last_completed_ts FROM maintenance_task WHERE id = ?`).get(task.id) as {
      due_ts: number;
      last_completed_ts: number;
    };
    expect(after.due_ts).toBe(999_999_999_999); // not overwritten
    expect(after.last_completed_ts).toBe(FIXED_NOW); // progress kept
    const subAfter = db.prepare(`SELECT done FROM sub_task WHERE id = ?`).get(sub.id) as { done: number };
    expect(subAfter.done).toBe(1); // tick preserved
  });

  it('declaratively prunes seeded rows no longer in SEED_TASKS, sparing manual tasks', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);

    // A leftover from an earlier, larger seed (a seed_key not in the current list)
    // plus a task the user created themselves (seed_key NULL).
    db.prepare(
      `INSERT INTO maintenance_task (id, title, recurrence_kind, enabled, seed_key) VALUES (?, ?, ?, 1, ?)`,
    ).run('orphan-1', 'Gammel sådd oppgave', 'annual', 'retired-seed-key');
    db.prepare(`INSERT INTO sub_task (id, parent_id, title, done, sort_order) VALUES (?, ?, ?, 0, 0)`).run(
      'orphan-sub',
      'orphan-1',
      'punkt',
    );
    db.prepare(
      `INSERT INTO maintenance_task (id, title, recurrence_kind, enabled, seed_key) VALUES (?, ?, ?, 1, NULL)`,
    ).run('manual-1', 'Min egen oppgave', 'once');

    const stats = seedMaintenance(db, FIXED_NOW);

    expect(stats.pruned).toBe(1);
    expect(db.prepare(`SELECT 1 FROM maintenance_task WHERE id = 'orphan-1'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM sub_task WHERE id = 'orphan-sub'`).get()).toBeUndefined(); // cascaded
    expect(db.prepare(`SELECT 1 FROM maintenance_task WHERE id = 'manual-1'`).get()).toBeTruthy(); // spared
  });

  it('grouped checklists are attached as sub-tasks', () => {
    const db = tempDb();
    seedMaintenance(db, FIXED_NOW);
    const happenings = SEED_TASKS.filter((t: { subTasks?: string[] }) => t.subTasks?.length);
    expect(happenings.length).toBeGreaterThan(0);
    for (const h of happenings as { seedKey: string; subTasks: string[] }[]) {
      const parent = db.prepare(`SELECT id FROM maintenance_task WHERE seed_key = ?`).get(h.seedKey) as { id: string };
      const subs = db.prepare(`SELECT COUNT(*) AS c FROM sub_task WHERE parent_id = ?`).get(parent.id) as { c: number };
      expect(subs.c).toBe(h.subTasks.length);
    }
  });

  it('ensureSchema back-fills descriptive columns on a pre-migration table', () => {
    const db = tempDb();
    // Old-shape table (pre descriptive columns).
    db.exec(`CREATE TABLE maintenance_task (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, recurrence_kind TEXT NOT NULL,
      interval_value INTEGER, interval_unit TEXT, annual_month INTEGER, annual_day INTEGER,
      due_ts INTEGER, last_completed_ts INTEGER, last_reminded_ts INTEGER, enabled INTEGER NOT NULL DEFAULT 1
    )`);
    ensureSchema(db);
    const cols = (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map((c) => c.name);
    for (const c of ['description', 'category', 'source', 'priority', 'season', 'estimated_minutes', 'cost_estimate', 'seed_key']) {
      expect(cols).toContain(c);
    }
  });
});
