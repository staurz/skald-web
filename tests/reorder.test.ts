import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import { createTask, listTasks, reorderTasks, addSubTask, toggleSubTask, completeTask, getTask, restoreTask } from '../src/lib/server/maintenance';

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

describe('restoreTask (undo)', () => {
  it('restores a completed once-task to active with its prior due date', () => {
    const db = freshDb();
    const t = createTask(db, { title: 'Vask', recurrenceKind: 'once', firstDueDate: '2026-07-01' }, 1000);
    const snap = {
      dueTs: t.dueTs,
      lastCompletedTs: t.lastCompletedTs,
      lastRemindedTs: t.lastRemindedTs,
      enabled: t.enabled,
      subTasks: [] as { id: string; done: boolean }[],
    };
    completeTask(db, t.id, 5000);
    expect(getTask(db, t.id)!.enabled).toBe(false); // once -> archived

    restoreTask(db, t.id, snap);
    const after = getTask(db, t.id)!;
    expect(after.enabled).toBe(true);
    expect(after.dueTs).toBe(t.dueTs);
    expect(after.lastCompletedTs).toBeNull();
  });

  it('restores a happening: re-checks sub-items and reactivates the prior schedule', () => {
    const db = freshDb();
    const t = createTask(db, { title: 'Vinterklar', recurrenceKind: 'annual', annualMonth: 10, annualDay: 15 }, 1000);
    const s1 = addSubTask(db, t.id, 'Robotklipper inn')!;
    const s2 = addSubTask(db, t.id, 'Takrenner')!;
    const before = getTask(db, t.id)!;
    const snap = {
      dueTs: before.dueTs,
      lastCompletedTs: before.lastCompletedTs,
      lastRemindedTs: before.lastRemindedTs,
      enabled: before.enabled,
      subTasks: [
        { id: s1.id, done: true },
        { id: s2.id, done: true },
      ],
    };
    toggleSubTask(db, s1.id, 5000);
    const res = toggleSubTask(db, s2.id, 5000); // last tick -> auto-complete
    expect(res.completed).toBe(true);
    expect(listTasks(db).find((x) => x.id === t.id)!.subTasks.every((s) => !s.done)).toBe(true);

    restoreTask(db, t.id, snap);
    const restored = listTasks(db).find((x) => x.id === t.id)!;
    expect(restored.subTasks.every((s) => s.done)).toBe(true);
    expect(restored.dueTs).toBe(before.dueTs);
    expect(restored.lastCompletedTs).toBe(before.lastCompletedTs);
  });
});
