import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import { createTask, listTasks, reorderTasks } from '../src/lib/server/maintenance';

describe('sort_order migration', () => {
  it('adds sort_order and backfills existing rows in due-date display order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reorder-mig-'));
    const path = join(dir, 'old.db');
    const raw = new Database(path);
    // Old-shape table: no sort_order, no descriptive columns.
    raw.exec(`CREATE TABLE maintenance_task (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, recurrence_kind TEXT NOT NULL,
      interval_value INTEGER, interval_unit TEXT, annual_month INTEGER, annual_day INTEGER,
      due_ts INTEGER, last_completed_ts INTEGER, last_reminded_ts INTEGER, enabled INTEGER NOT NULL DEFAULT 1
    )`);
    const ins = raw.prepare(
      `INSERT INTO maintenance_task (id, title, recurrence_kind, due_ts, enabled) VALUES (?, ?, 'once', ?, 1)`,
    );
    ins.run('b', 'B', 2000); // later due
    ins.run('a', 'A', 1000); // earlier due
    ins.run('c', 'C', null); // no date -> last
    raw.close();

    const db = openDb(path);
    const rows = db.prepare(`SELECT id, sort_order FROM maintenance_task ORDER BY sort_order`).all() as {
      id: string;
      sort_order: number;
    }[];
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']); // due asc, nulls last
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });
});

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reorder-'));
  return openDb(join(dir, 'test.db'));
}

describe('task ordering', () => {
  it('createTask appends with an increasing sort_order', () => {
    const db = freshDb();
    createTask(db, { title: 'first', recurrenceKind: 'once' }, 1000);
    createTask(db, { title: 'second', recurrenceKind: 'once' }, 1000);
    const tasks = listTasks(db);
    expect(tasks.map((t) => t.title)).toEqual(['first', 'second']);
  });

  it('reorderTasks rewrites order and listTasks reflects it', () => {
    const db = freshDb();
    const a = createTask(db, { title: 'A', recurrenceKind: 'once' }, 1000);
    const b = createTask(db, { title: 'B', recurrenceKind: 'once' }, 1000);
    const c = createTask(db, { title: 'C', recurrenceKind: 'once' }, 1000);
    reorderTasks(db, [c.id, a.id, b.id]);
    expect(listTasks(db).map((t) => t.title)).toEqual(['C', 'A', 'B']);
  });

  it('reorderTasks tolerates unknown ids', () => {
    const db = freshDb();
    const a = createTask(db, { title: 'A', recurrenceKind: 'once' }, 1000);
    expect(() => reorderTasks(db, ['ghost', a.id])).not.toThrow();
    expect(listTasks(db).map((t) => t.title)).toEqual(['A']);
  });
});
