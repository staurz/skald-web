import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';
import {
  createTask,
  listTasks,
  addSubTask,
  deleteSubTask,
  deleteTask,
  toggleSubTask,
} from '../src/lib/server/maintenance';

function tempDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'sub-')), 'test.db'));
}

describe('sub_task schema', () => {
  it('creates the table with the expected columns', () => {
    const db = tempDb();
    const cols = (db.prepare(`PRAGMA table_info(sub_task)`).all() as { name: string }[])
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual(['done', 'id', 'parent_id', 'sort_order', 'title'].sort());
  });
});

describe('sub-task CRUD + nesting', () => {
  it('adds sub-tasks with increasing sort_order and nests them in listTasks', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'Vinterforb.', recurrenceKind: 'annual', annualMonth: 10, annualDay: 1 },
      Date.parse('2025-06-01T10:00:00Z'),
    );
    const a = addSubTask(db, t.id, 'Robotklippere');
    const b = addSubTask(db, t.id, 'Takrenner');
    expect(a!.sortOrder).toBe(0);
    expect(b!.sortOrder).toBe(1);
    const happening = listTasks(db).find((x) => x.id === t.id)!;
    expect(happening.subTasks.map((s) => s.title)).toEqual(['Robotklippere', 'Takrenner']);
    expect(happening.subTasks[0].done).toBe(false);
  });

  it('gives plain tasks an empty subTasks array', () => {
    const db = tempDb();
    createTask(db, { title: 'Plain', recurrenceKind: 'once' }, Date.now());
    expect(listTasks(db)[0].subTasks).toEqual([]);
  });

  it('addSubTask returns null for a missing parent', () => {
    const db = tempDb();
    expect(addSubTask(db, 'nope', 'x')).toBeNull();
  });

  it('deletes a sub-task', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'H', recurrenceKind: 'once' }, Date.now());
    const a = addSubTask(db, t.id, 'one');
    deleteSubTask(db, a!.id);
    expect(listTasks(db).find((x) => x.id === t.id)!.subTasks).toEqual([]);
  });

  it('deleteTask removes the parent and its sub-tasks', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'H', recurrenceKind: 'once' }, Date.now());
    addSubTask(db, t.id, 'one');
    deleteTask(db, t.id);
    expect(listTasks(db)).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sub_task').get()).toEqual({ n: 0 });
  });
});

describe('toggleSubTask + auto-complete', () => {
  it('flips done and does not complete while items remain', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'H', recurrenceKind: 'once', firstDueDate: '2025-09-01' },
      Date.parse('2025-06-01T10:00:00Z'),
    );
    const a = addSubTask(db, t.id, 'one');
    addSubTask(db, t.id, 'two');
    const r = toggleSubTask(db, a!.id, Date.now());
    expect(r.completed).toBe(false);
    const happening = listTasks(db).find((x) => x.id === t.id)!;
    expect(happening.subTasks.find((s) => s.id === a!.id)!.done).toBe(true);
  });

  it('archives a once happening when the last item is ticked', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'H', recurrenceKind: 'once', firstDueDate: '2025-09-01' },
      Date.parse('2025-06-01T10:00:00Z'),
    );
    const a = addSubTask(db, t.id, 'one');
    const r = toggleSubTask(db, a!.id, Date.parse('2025-09-01T12:00:00Z'));
    expect(r.completed).toBe(true);
    expect(listTasks(db).find((x) => x.id === t.id)).toBeUndefined();
  });

  it('reschedules a recurring happening and resets its items when all ticked', () => {
    const db = tempDb();
    const t = createTask(
      db,
      { title: 'Vinterforb.', recurrenceKind: 'annual', annualMonth: 10, annualDay: 1 },
      Date.parse('2025-06-01T10:00:00Z'),
    );
    const a = addSubTask(db, t.id, 'one');
    const b = addSubTask(db, t.id, 'two');
    const firstDue = listTasks(db).find((x) => x.id === t.id)!.dueTs!;
    toggleSubTask(db, a!.id, Date.parse('2025-10-01T12:00:00Z'));
    const r = toggleSubTask(db, b!.id, Date.parse('2025-10-01T12:00:00Z'));
    expect(r.completed).toBe(true);
    const after = listTasks(db).find((x) => x.id === t.id)!;
    expect(after.dueTs).toBeGreaterThan(firstDue);
    expect(after.subTasks.every((s) => s.done === false)).toBe(true);
  });

  it('returns completed=false for a missing sub-task', () => {
    const db = tempDb();
    expect(toggleSubTask(db, 'nope', Date.now())).toEqual({ completed: false });
  });
});
