import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'maint-'));
  return openDb(join(dir, 'test.db'));
}

describe('maintenance_task schema', () => {
  it('creates the table with the expected columns', () => {
    const db = tempDb();
    const cols = db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'annual_day',
        'annual_month',
        'due_ts',
        'enabled',
        'id',
        'interval_unit',
        'interval_value',
        'last_completed_ts',
        'last_reminded_ts',
        'notes',
        'recurrence_kind',
        'title',
      ].sort(),
    );
  });
});
