# Task Happenings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a maintenance task own a checklist of sub-tasks ("happenings" like Vinterforberedelse); ticking the last item auto-completes the happening, rescheduling and resetting the checklist for recurring ones.

**Architecture:** A new `sub_task` table references `maintenance_task(id)`. A happening is any task with ≥1 sub-task — no new type. The parent keeps its existing scheduling/reminder. New store functions add/toggle/delete sub-tasks and nest them into `listTasks`; toggling the last item reuses the existing `completeTask`. Three new endpoints + nested rendering on the tasks page.

**Tech Stack:** SvelteKit (adapter-node), better-sqlite3, Vitest, Svelte 5 runes.

**Spec:** `docs/superpowers/specs/2026-06-01-task-happenings-design.md`. Build on branch `feat/house-maintenance`.

---

## File Structure
- Modify `src/lib/server/db.ts` — add `sub_task` table + index; enable `PRAGMA foreign_keys`.
- Modify `src/lib/server/maintenance-types.ts` — add `SubTask`; add `subTasks` to `MaintenanceTask`.
- Modify `src/lib/server/maintenance.ts` — sub-task store fns + nesting + cascade.
- Create `src/routes/api/maintenance/tasks/[id]/subtasks/+server.ts` — POST add item.
- Create `src/routes/api/maintenance/subtasks/[subId]/toggle/+server.ts` — POST toggle.
- Create `src/routes/api/maintenance/subtasks/[subId]/+server.ts` — DELETE item.
- Modify `src/routes/tasks/+page.svelte` — nested happening UI.
- Tests: `tests/subtask.test.ts`.

---

## Task 1: sub_task table + FK enforcement

**Files:**
- Modify: `src/lib/server/db.ts`
- Test: `tests/subtask.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/subtask.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/subtask.test.ts`
Expected: FAIL — no such table `sub_task`.

- [ ] **Step 3: Add the table to the SCHEMA string in `src/lib/server/db.ts`** (after the `maintenance_task` table, still inside the same backtick template):

```sql
CREATE TABLE IF NOT EXISTS sub_task (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (parent_id) REFERENCES maintenance_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sub_task_parent ON sub_task(parent_id);
```

- [ ] **Step 4: Enable FK enforcement in `openDb`.** In `src/lib/server/db.ts`, right after the existing `db.pragma('journal_mode = WAL');` line, add:

```ts
  db.pragma('foreign_keys = ON');
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/subtask.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db.ts tests/subtask.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(happenings): add sub_task table and enable FK enforcement"
```

---

## Task 2: SubTask type + add/delete/list-nesting

**Files:**
- Modify: `src/lib/server/maintenance-types.ts`
- Modify: `src/lib/server/maintenance.ts`
- Test: `tests/subtask.test.ts`

- [ ] **Step 1: Add the type.** In `src/lib/server/maintenance-types.ts`, add the `SubTask` interface and add a `subTasks` field to `MaintenanceTask`:

```ts
export interface SubTask {
  id: string;
  parentId: string;
  title: string;
  done: boolean;
  sortOrder: number;
}
```

In the existing `MaintenanceTask` interface, add this line (e.g. after `enabled: boolean;`):

```ts
  subTasks: SubTask[];
```

- [ ] **Step 2: Append failing tests** to `tests/subtask.test.ts`:

```ts
import {
  createTask,
  listTasks,
  addSubTask,
  deleteSubTask,
  deleteTask,
} from '../src/lib/server/maintenance';

describe('sub-task CRUD + nesting', () => {
  it('adds sub-tasks with increasing sort_order and nests them in listTasks', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'Vinterforb.', recurrenceKind: 'annual', annualMonth: 10, annualDay: 1 }, Date.parse('2025-06-01T10:00:00Z'));
    const a = addSubTask(db, t.id, 'Robotklippere');
    const b = addSubTask(db, t.id, 'Takrenner');
    expect(a!.sortOrder).toBe(0);
    expect(b!.sortOrder).toBe(1);
    const list = listTasks(db);
    const happening = list.find((x) => x.id === t.id)!;
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/subtask.test.ts`
Expected: FAIL — `addSubTask`/`deleteSubTask` not exported (and `subTasks` missing).

- [ ] **Step 4: Implement in `src/lib/server/maintenance.ts`.**

(a) Add `SubTask` to the type import:
```ts
import type { MaintenanceTask, SubTask, TaskInput } from './maintenance-types';
```

(b) Add a sub-task row type + mappers near the existing `Row`/`toTask`:
```ts
interface SubRow {
  id: string;
  parent_id: string;
  title: string;
  done: number;
  sort_order: number;
}

function toSub(r: SubRow): SubTask {
  return { id: r.id, parentId: r.parent_id, title: r.title, done: !!r.done, sortOrder: r.sort_order };
}

const SUB_SELECT = 'SELECT id, parent_id, title, done, sort_order FROM sub_task';

export function getSubTask(db: Database.Database, id: string): SubTask | null {
  const r = db.prepare(`${SUB_SELECT} WHERE id = ?`).get(id) as SubRow | undefined;
  return r ? toSub(r) : null;
}
```

(c) In `toTask`, initialize the new field. Change the returned object to include:
```ts
    enabled: !!r.enabled,
    subTasks: [],
```
(append `subTasks: []` right after the `enabled` line in the object literal).

(d) Replace `listTasks` so it nests sub-tasks:
```ts
export function listTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY due_ts IS NULL, due_ts ASC`).all() as Row[];
  const tasks = rows.map(toTask);
  const subs = db
    .prepare(`${SUB_SELECT} ORDER BY sort_order ASC, rowid ASC`)
    .all() as SubRow[];
  const byParent = new Map<string, SubTask[]>();
  for (const s of subs) {
    const arr = byParent.get(s.parent_id) ?? [];
    arr.push(toSub(s));
    byParent.set(s.parent_id, arr);
  }
  for (const t of tasks) t.subTasks = byParent.get(t.id) ?? [];
  return tasks;
}
```

(e) Add `addSubTask` and `deleteSubTask`:
```ts
export function addSubTask(db: Database.Database, parentId: string, title: string): SubTask | null {
  if (!getTask(db, parentId)) return null;
  const id = randomUUID();
  const { n } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sub_task WHERE parent_id = ?')
    .get(parentId) as { n: number };
  db.prepare('INSERT INTO sub_task (id, parent_id, title, done, sort_order) VALUES (?, ?, ?, 0, ?)').run(
    id,
    parentId,
    title,
    n,
  );
  return getSubTask(db, id);
}

export function deleteSubTask(db: Database.Database, subId: string): void {
  db.prepare('DELETE FROM sub_task WHERE id = ?').run(subId);
}
```

(f) Update `deleteTask` to remove children first:
```ts
export function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM sub_task WHERE parent_id = ?').run(id);
  db.prepare('DELETE FROM maintenance_task WHERE id = ?').run(id);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/subtask.test.ts` then `npm run check`
Expected: all sub-task tests pass; 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/maintenance.ts src/lib/server/maintenance-types.ts tests/subtask.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(happenings): sub-task type, CRUD, and listTasks nesting"
```

---

## Task 3: toggleSubTask with auto-complete

**Files:**
- Modify: `src/lib/server/maintenance.ts`
- Test: `tests/subtask.test.ts`

- [ ] **Step 1: Append failing tests** to `tests/subtask.test.ts`:

```ts
import { toggleSubTask } from '../src/lib/server/maintenance';

describe('toggleSubTask + auto-complete', () => {
  it('flips done and does not complete while items remain', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'H', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    const a = addSubTask(db, t.id, 'one');
    addSubTask(db, t.id, 'two');
    const r = toggleSubTask(db, a!.id, Date.now());
    expect(r.completed).toBe(false);
    const happening = listTasks(db).find((x) => x.id === t.id)!;
    expect(happening.subTasks.find((s) => s.id === a!.id)!.done).toBe(true);
  });

  it('archives a once happening when the last item is ticked', () => {
    const db = tempDb();
    const t = createTask(db, { title: 'H', recurrenceKind: 'once', firstDueDate: '2025-09-01' }, Date.parse('2025-06-01T10:00:00Z'));
    const a = addSubTask(db, t.id, 'one');
    const r = toggleSubTask(db, a!.id, Date.parse('2025-09-01T12:00:00Z'));
    expect(r.completed).toBe(true);
    expect(listTasks(db).find((x) => x.id === t.id)).toBeUndefined(); // archived, off active list
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
    expect(after.dueTs).toBeGreaterThan(firstDue); // rescheduled to next year
    expect(after.subTasks.every((s) => s.done === false)).toBe(true); // reset
  });

  it('returns completed=false for a missing sub-task', () => {
    const db = tempDb();
    expect(toggleSubTask(db, 'nope', Date.now())).toEqual({ completed: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/subtask.test.ts`
Expected: FAIL — `toggleSubTask` not exported.

- [ ] **Step 3: Implement `toggleSubTask` in `src/lib/server/maintenance.ts`** (place after `deleteSubTask`; it uses the existing `completeTask` and `getTask`):

```ts
export function toggleSubTask(db: Database.Database, subId: string, now: number): { completed: boolean } {
  const sub = getSubTask(db, subId);
  if (!sub) return { completed: false };
  db.prepare('UPDATE sub_task SET done = ? WHERE id = ?').run(sub.done ? 0 : 1, subId);

  const { total, doneCount } = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS doneCount FROM sub_task WHERE parent_id = ?')
    .get(sub.parentId) as { total: number; doneCount: number };

  if (total > 0 && doneCount === total) {
    completeTask(db, sub.parentId, now);
    // If the parent is still active (a recurring task that rescheduled), the
    // checklist starts fresh for the next occurrence. An archived once-task
    // keeps its items as a record.
    const parent = getTask(db, sub.parentId);
    if (parent && parent.enabled) {
      db.prepare('UPDATE sub_task SET done = 0 WHERE parent_id = ?').run(sub.parentId);
    }
    return { completed: true };
  }
  return { completed: false };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/subtask.test.ts` then `npm run check`
Expected: all pass; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/maintenance.ts tests/subtask.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(happenings): toggleSubTask auto-completes and resets the checklist"
```

---

## Task 4: Sub-task API endpoints

**Files:**
- Create: `src/routes/api/maintenance/tasks/[id]/subtasks/+server.ts`
- Create: `src/routes/api/maintenance/subtasks/[subId]/toggle/+server.ts`
- Create: `src/routes/api/maintenance/subtasks/[subId]/+server.ts`

- [ ] **Step 1: Create the add-item endpoint** `src/routes/api/maintenance/tasks/[id]/subtasks/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { addSubTask } from '$lib/server/maintenance';

export const POST: RequestHandler = async ({ params, request }) => {
  const { title } = (await request.json()) as { title?: string };
  if (!title || !title.trim()) throw error(400, 'title required');
  const sub = addSubTask(openDb(), params.id!, title.trim());
  if (!sub) throw error(404, 'parent not found');
  return json({ subTask: sub }, { status: 201 });
};
```

- [ ] **Step 2: Create the toggle endpoint** `src/routes/api/maintenance/subtasks/[subId]/toggle/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { toggleSubTask } from '$lib/server/maintenance';

export const POST: RequestHandler = ({ params }) => {
  return json(toggleSubTask(openDb(), params.subId!, Date.now()));
};
```

- [ ] **Step 3: Create the delete endpoint** `src/routes/api/maintenance/subtasks/[subId]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { deleteSubTask } from '$lib/server/maintenance';

export const DELETE: RequestHandler = ({ params }) => {
  deleteSubTask(openDb(), params.subId!);
  return json({ ok: true });
};
```

- [ ] **Step 4: Verify** — run `npm run check` (svelte-kit sync generates the `./$types`; if it complains about missing types, run `npx svelte-kit sync` first). Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/maintenance/
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(happenings): sub-task API (add/toggle/delete)"
```

---

## Task 5: Nested happening UI on the tasks page

**Files:**
- Modify: `src/routes/tasks/+page.svelte`

- [ ] **Step 1: Add type import and state.** In the `<script>` of `src/routes/tasks/+page.svelte`, update the type import to include `SubTask` and add expand/new-item state plus sub-task action functions.

Update the import line to:
```ts
  import type { MaintenanceTask, TaskInput, RecurrenceKind, IntervalUnit, SubTask } from '$lib/server/maintenance-types';
```

Add after the existing `let editingId = $state<string | null>(null);` line:
```ts
  let expanded = $state<Record<string, boolean>>({});
  let newItem = $state<Record<string, string>>({});

  function toggleExpand(id: string) {
    expanded[id] = !expanded[id];
  }

  async function addItem(parentId: string) {
    const title = (newItem[parentId] ?? '').trim();
    if (!title) return;
    const r = await fetch(`/api/maintenance/tasks/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (r.ok) {
      newItem[parentId] = '';
      expanded[parentId] = true;
      await load();
    }
  }

  async function toggleSub(subId: string) {
    await fetch(`/api/maintenance/subtasks/${subId}/toggle`, { method: 'POST' });
    await load();
  }

  async function removeSub(subId: string) {
    await fetch(`/api/maintenance/subtasks/${subId}`, { method: 'DELETE' });
    await load();
  }

  function progress(t: MaintenanceTask): string {
    const done = t.subTasks.filter((s) => s.done).length;
    return `${done}/${t.subTasks.length}`;
  }
```

- [ ] **Step 2: Replace the task `<li>` markup** so happenings render as expandable checklists. Replace this existing block:

```svelte
        {#each section.items as t (t.id)}
          <li class={group(t)}>
            <button class="check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete">✓</button>
            <span class="title">{t.title}</span>
            {#if t.dueTs !== null}<span class="due">{fmtDue(t.dueTs)}</span>{/if}
            <button class="edit" title="Edit" onclick={() => startEdit(t)} aria-label="Edit">✎</button>
            <button class="del" title="Delete" onclick={() => remove(t.id)} aria-label="Delete">✕</button>
          </li>
        {/each}
```

with:

```svelte
        {#each section.items as t (t.id)}
          <li class={group(t)}>
            <div class="row">
              {#if t.subTasks.length > 0}
                <button class="check" title="Expand" onclick={() => toggleExpand(t.id)} aria-label="Expand">{expanded[t.id] ? '▾' : '▸'}</button>
                <span class="title">{t.title}</span>
                <span class="count">{progress(t)}</span>
              {:else}
                <button class="check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete">✓</button>
                <span class="title">{t.title}</span>
              {/if}
              {#if t.dueTs !== null}<span class="due">{fmtDue(t.dueTs)}</span>{/if}
              <button class="edit" title="Edit" onclick={() => startEdit(t)} aria-label="Edit">✎</button>
              <button class="del" title="Delete" onclick={() => remove(t.id)} aria-label="Delete">✕</button>
            </div>

            {#if expanded[t.id] || t.subTasks.length === 0}
              <div class="items">
                {#each t.subTasks as s (s.id)}
                  <label class="item">
                    <input type="checkbox" checked={s.done} onchange={() => toggleSub(s.id)} />
                    <span class:done={s.done}>{s.title}</span>
                    <button class="del small" title="Remove item" onclick={() => removeSub(s.id)} aria-label="Remove item">✕</button>
                  </label>
                {/each}
                <form class="add-item" onsubmit={(e) => { e.preventDefault(); addItem(t.id); }}>
                  <input placeholder="+ add item…" bind:value={newItem[t.id]} aria-label="New checklist item" />
                </form>
              </div>
            {/if}
          </li>
        {/each}
```

Note: the "+ add item" input shows for every task (so a plain task can become a happening by adding its first item). For a task that already has items, the items + input show only when expanded.

- [ ] **Step 3: Add styles.** Append to the `<style>` block:

```css
  .row { display: flex; align-items: center; gap: 10px; }
  .count { font-size: 0.8rem; opacity: 0.7; }
  .items { margin: 8px 0 0 28px; display: flex; flex-direction: column; gap: 6px; }
  .item { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; }
  .item span.done { text-decoration: line-through; opacity: 0.5; }
  .add-item input { width: 100%; padding: 6px 10px; border-radius: var(--radius, 10px); border: 1px solid var(--border, #3334); font: inherit; }
  .del.small { font-size: 0.8rem; margin-left: auto; }
```

Also update the existing `li { ... }` rule so a happening can stack its row and items vertically — change the `li` rule from `display: flex; align-items: center;` to:

```css
  li { display: flex; flex-direction: column; padding: 10px 12px; border-radius: var(--radius, 10px); background: var(--card, #1c1c1e0a); }
```

(keep the existing `gap`/`border-radius`/`background`; the key change is `flex-direction: column` and dropping `align-items: center`, since the `.row` div now handles horizontal layout).

- [ ] **Step 4: Verify** — run `npm run check`. Expected: 0 errors. Then load `/tasks` in the running app: add a task, expand it, add a couple of items, tick them, confirm the count updates and ticking the last item completes/reschedules.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tasks/+page.svelte
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(happenings): nested checklist UI on tasks page"
```

---

## Final verification
- [ ] `npm test` — all pass (existing 94 + new sub-task tests).
- [ ] `npm run check` — 0 errors.
- [ ] Manual: create an annual "Vinterforberedelse", add items, tick all → it reschedules to next year and the checklist resets.
