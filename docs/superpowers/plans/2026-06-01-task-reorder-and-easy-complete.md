# Drag-to-Reorder + Easier Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user hand-order tasks by dragging within each date section, and make completing a task easier with a big tap-target checkbox plus an Undo affordance.

**Architecture:** Add a persisted `sort_order` to `maintenance_task`; `listTasks` orders by it and the UI partitions into date sections client-side. A `PUT /reorder` endpoint rewrites order from a full id list. Completion gets a large checkbox; an Undo toast restores the pre-completion state via a stateless `POST /uncomplete` carrying a client-held snapshot. Dragging uses `svelte-dnd-action` (touch + keyboard), one zone per section with a unique `type` so cards can't cross sections, and a `.drag` handle.

**Tech Stack:** SvelteKit (adapter-node), Svelte 5 runes, better-sqlite3, Vitest, `svelte-dnd-action`.

**Test-execution note:** Tasks 1, 2, and 4 add Vitest tests that hit better-sqlite3. The shared `node_modules` holds only one platform's native binary at a time; the user runs `npm test` on **Windows**. Under WSL these DB tests fail to load the binary — that is expected and not a logic failure. Always run `npm run check` (typecheck, platform-independent) after every task; the user runs `npm test` on Windows to confirm the DB tests.

---

### Task 1: Add `sort_order` column with order-preserving backfill

**Files:**
- Modify: `src/lib/server/db.ts`
- Test: `tests/reorder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/reorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run (on Windows): `npm test -- reorder`
Expected: FAIL — `sort_order` column does not exist (`no such column: sort_order`).

- [ ] **Step 3: Add the column to SCHEMA and the migration map**

In `src/lib/server/db.ts`, add `sort_order` to the `maintenance_task` table in `SCHEMA`. Place it right after the `enabled` line:

```
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
```

Add it to `MAINTENANCE_TASK_COLUMNS` (so existing DBs get an ALTER):

```ts
const MAINTENANCE_TASK_COLUMNS: Record<string, string> = {
  description: 'TEXT',
  category: 'TEXT',
  source: "TEXT NOT NULL DEFAULT 'manual'",
  priority: 'TEXT',
  season: 'TEXT',
  estimated_minutes: 'INTEGER',
  cost_estimate: 'TEXT',
  seed_key: 'TEXT',
  sort_order: 'INTEGER NOT NULL DEFAULT 0',
};
```

- [ ] **Step 4: Backfill order when the column is newly added**

In `migrate()` in `src/lib/server/db.ts`, capture whether `sort_order` was missing before the ALTER loop, then backfill after it. Replace the body of `migrate` with:

```ts
function migrate(db: Database.Database): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(maintenance_task)`).all() as { name: string }[]).map((c) => c.name),
  );
  const sortOrderWasMissing = !existing.has('sort_order');
  for (const [name, decl] of Object.entries(MAINTENANCE_TASK_COLUMNS)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE maintenance_task ADD COLUMN ${name} ${decl}`);
    }
  }
  // First time sort_order appears on an existing DB, seed it in the previous
  // display order (due asc, undated last) so nothing visually jumps.
  if (sortOrderWasMissing) {
    const rows = db
      .prepare(`SELECT id FROM maintenance_task ORDER BY due_ts IS NULL, due_ts ASC, rowid ASC`)
      .all() as { id: string }[];
    const upd = db.prepare(`UPDATE maintenance_task SET sort_order = ? WHERE id = ?`);
    const tx = db.transaction((list: { id: string }[]) => {
      list.forEach((r, i) => upd.run(i, r.id));
    });
    tx(rows);
  }
  // Safe to (re)create after the column exists; no-op once present.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_seed_key ON maintenance_task(seed_key)`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (on Windows): `npm test -- reorder`
Expected: PASS.
Then run `npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db.ts tests/reorder.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): add sort_order column with order-preserving backfill"
```

---

### Task 2: Order by `sort_order`, append new tasks, add `reorderTasks`

**Files:**
- Modify: `src/lib/server/maintenance.ts`
- Test: `tests/reorder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/reorder.test.ts` (add the imports at the top of the file alongside the existing ones):

```ts
import { openDb } from '../src/lib/server/db';
import { createTask, listTasks, reorderTasks } from '../src/lib/server/maintenance';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (on Windows): `npm test -- reorder`
Expected: FAIL — `reorderTasks` is not exported, and ordering assertions fail.

- [ ] **Step 3: Change `listTasks` ordering**

In `src/lib/server/maintenance.ts`, change the `listTasks` query order:

```ts
export function listTasks(db: Database.Database): MaintenanceTask[] {
  const rows = db.prepare(`${SELECT} WHERE enabled = 1 ORDER BY sort_order ASC, rowid ASC`).all() as Row[];
  const tasks = rows.map(toTask);
  const subs = db.prepare(`${SUB_SELECT} ORDER BY sort_order ASC, rowid ASC`).all() as SubRow[];
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

- [ ] **Step 4: Make `createTask` append with the next `sort_order`**

In `createTask`, compute the next order and include it in the INSERT. Replace the function body's INSERT section:

```ts
export function createTask(db: Database.Database, input: TaskInput, now: number): MaintenanceTask {
  const id = randomUUID();
  const due = computeInitialDue(input, now, TZ);
  const { n } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM maintenance_task`)
    .get() as { n: number };
  db.prepare(
    `INSERT INTO maintenance_task
      (id, title, notes, recurrence_kind, interval_value, interval_unit, annual_month, annual_day, due_ts, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    input.title,
    input.notes ?? null,
    input.recurrenceKind,
    input.intervalValue ?? null,
    input.intervalUnit ?? null,
    input.annualMonth ?? null,
    input.annualDay ?? null,
    due,
    n,
  );
  return getTask(db, id)!;
}
```

- [ ] **Step 5: Add `reorderTasks`**

Add to `src/lib/server/maintenance.ts` (after `deleteTask`):

```ts
// Rewrite the manual order of tasks. `ids` is the complete top-to-bottom list;
// each task's sort_order becomes its index. Unknown ids are ignored.
export function reorderTasks(db: Database.Database, ids: string[]): void {
  const upd = db.prepare('UPDATE maintenance_task SET sort_order = ? WHERE id = ?');
  const tx = db.transaction((list: string[]) => {
    list.forEach((id, i) => upd.run(i, id));
  });
  tx(ids);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run (on Windows): `npm test -- reorder`
Expected: PASS (all of Task 1 + Task 2 tests).
Then `npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/maintenance.ts tests/reorder.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): order tasks by sort_order and add reorderTasks"
```

---

### Task 3: Reorder API endpoint

**Files:**
- Create: `src/routes/api/maintenance/tasks/reorder/+server.ts`

Note: the static `reorder` segment takes routing priority over the sibling `[id]` dynamic segment, so `PUT /api/maintenance/tasks/reorder` resolves here, not to `[id]`.

- [ ] **Step 1: Create the endpoint**

Create `src/routes/api/maintenance/tasks/reorder/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { reorderTasks } from '$lib/server/maintenance';

export const PUT: RequestHandler = async ({ request }) => {
  const { ids } = (await request.json()) as { ids?: string[] };
  if (!Array.isArray(ids)) throw error(400, 'ids array required');
  reorderTasks(openDb(), ids);
  return json({ ok: true });
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run check`
Expected: 0 errors (the `./$types` import resolves after `svelte-kit sync`, which `check` runs).

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/maintenance/tasks/reorder/+server.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): PUT /reorder endpoint"
```

---

### Task 4: `restoreTask` store function + uncomplete endpoint

**Files:**
- Modify: `src/lib/server/maintenance.ts`
- Create: `src/routes/api/maintenance/tasks/[id]/uncomplete/+server.ts`
- Test: `tests/reorder.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/reorder.test.ts` (extend the maintenance import to include `addSubTask`, `toggleSubTask`, `completeTask`, `getTask`, `restoreTask`):

```ts
import {
  createTask,
  listTasks,
  reorderTasks,
  addSubTask,
  toggleSubTask,
  completeTask,
  getTask,
  restoreTask,
} from '../src/lib/server/maintenance';

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
    // Snapshot the pre-completion state: both sub-items done, original schedule.
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
    // Recurring parent: subs were reset to undone after completion.
    expect(listTasks(db).find((x) => x.id === t.id)!.subTasks.every((s) => !s.done)).toBe(true);

    restoreTask(db, t.id, snap);
    const restored = listTasks(db).find((x) => x.id === t.id)!;
    expect(restored.subTasks.every((s) => s.done)).toBe(true);
    expect(restored.dueTs).toBe(before.dueTs);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (on Windows): `npm test -- reorder`
Expected: FAIL — `restoreTask` not exported.

- [ ] **Step 3: Add the `CompletionSnapshot` type**

In `src/lib/server/maintenance-types.ts`, add at the end (before `REMINDER_HOUR` is fine; keep export):

```ts
// The pre-completion state the client holds so an Undo can restore it.
export interface CompletionSnapshot {
  dueTs: number | null;
  lastCompletedTs: number | null;
  lastRemindedTs: number | null;
  enabled: boolean;
  subTasks: { id: string; done: boolean }[];
}
```

- [ ] **Step 4: Add `restoreTask`**

In `src/lib/server/maintenance.ts`, update the type import to include `CompletionSnapshot`:

```ts
import type { MaintenanceTask, SubTask, TaskInput, CompletionSnapshot } from './maintenance-types';
```

Add after `completeTask`:

```ts
// Undo a completion: write the pre-completion snapshot back onto the task and
// restore each captured sub-item's done state (a recurring happening had them
// reset to 0 on completion).
export function restoreTask(
  db: Database.Database,
  id: string,
  snap: CompletionSnapshot,
): MaintenanceTask | null {
  if (!getTask(db, id)) return null;
  const updTask = db.prepare(
    'UPDATE maintenance_task SET due_ts = ?, last_completed_ts = ?, last_reminded_ts = ?, enabled = ? WHERE id = ?',
  );
  const updSub = db.prepare('UPDATE sub_task SET done = ? WHERE id = ?');
  const tx = db.transaction(() => {
    updTask.run(snap.dueTs, snap.lastCompletedTs, snap.lastRemindedTs, snap.enabled ? 1 : 0, id);
    for (const s of snap.subTasks) updSub.run(s.done ? 1 : 0, s.id);
  });
  tx();
  return getTask(db, id);
}
```

- [ ] **Step 5: Create the uncomplete endpoint**

Create `src/routes/api/maintenance/tasks/[id]/uncomplete/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/server/db';
import { restoreTask } from '$lib/server/maintenance';
import type { CompletionSnapshot } from '$lib/server/maintenance-types';

export const POST: RequestHandler = async ({ params, request }) => {
  const snap = (await request.json()) as CompletionSnapshot;
  return json({ task: restoreTask(openDb(), params.id!, snap) });
};
```

- [ ] **Step 6: Run tests + typecheck**

Run (on Windows): `npm test -- reorder`
Expected: PASS (all reorder.test.ts tests).
Then `npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/maintenance.ts src/lib/server/maintenance-types.ts src/routes/api/maintenance/tasks/[id]/uncomplete/+server.ts tests/reorder.test.ts
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): restoreTask + uncomplete endpoint for undo"
```

---

### Task 5: Install `svelte-dnd-action` and wire drag-to-reorder

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/routes/tasks/+page.svelte`

No automated test (no Svelte component test harness in this repo); verify via `npm run check` and manual drag in the browser.

- [ ] **Step 1: Install the library**

Run: `npm install svelte-dnd-action`
Expected: adds `svelte-dnd-action` to `dependencies`. (If the sandbox blocks the network, retry with the sandbox disabled.)

- [ ] **Step 2: Replace the `grouped` derived with writable sections + imports**

In `src/routes/tasks/+page.svelte`, update the script. Add imports at the top:

```ts
import { onMount } from 'svelte';
import { dndzone } from 'svelte-dnd-action';
import { flip } from 'svelte/animate';
```

Replace the `grouped` derived (the `let grouped = $derived(...)` block) with `$state`-backed sections rebuilt after every load:

```ts
const FLIP_MS = 150;
let sections = $state<{ key: 'overdue' | 'soon' | 'upcoming' | 'todo'; label: string; items: MaintenanceTask[] }[]>([]);

function rebuildSections() {
  sections = (['overdue', 'soon', 'upcoming', 'todo'] as const)
    .map((g) => ({ key: g, label: labels[g], items: tasks.filter((t) => group(t) === g) }))
    .filter((s) => s.items.length > 0);
}

// Persist the full top-to-bottom order across all sections.
function persistOrder() {
  const ids = sections.flatMap((s) => s.items.map((t) => t.id));
  fetch('/api/maintenance/tasks/reorder', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

function handleDnd(key: string, items: MaintenanceTask[], commit: boolean) {
  const sec = sections.find((s) => s.key === key);
  if (sec) sec.items = items; // live preview during drag, committed order on finalize
  if (commit) persistOrder();
}
```

- [ ] **Step 3: Rebuild sections after load**

Update `load` so the sections refresh whenever tasks change:

```ts
async function load() {
  const r = await fetch('/api/maintenance/tasks');
  if (r.ok) tasks = (await r.json()).tasks;
  rebuildSections();
}
onMount(load);
```

- [ ] **Step 4: Use the dnd zone in the template**

Replace the `{#each grouped as section (section.key)}` block's `<ul>` and its `{#each}` with a dnd-enabled version. The `<ul>` gets the `dndzone` action (unique `type` per section, drag handle selector `.drag`), and each `<li>` animates with `flip` and carries a `.drag` handle:

```svelte
{#each sections as section (section.key)}
  <section>
    <h2>{section.label}</h2>
    <ul
      use:dndzone={{ items: section.items, type: section.key, flipDurationMs: FLIP_MS, dragHandleSelector: '.drag', dropTargetStyle: {} }}
      onconsider={(e) => handleDnd(section.key, e.detail.items, false)}
      onfinalize={(e) => handleDnd(section.key, e.detail.items, true)}
    >
      {#each section.items as t (t.id)}
        <li class={group(t)} animate:flip={{ duration: FLIP_MS }}>
          <div class="row">
            <span class="drag" aria-label="Drag to reorder" title="Drag to reorder">⠿</span>
            {#if t.subTasks.length > 0}
              <button class="check" title="Expand" onclick={() => toggleExpand(t.id)} aria-label="Expand">{expanded[t.id] ? '▾' : '▸'}</button>
              <span class="title">{t.title}</span>
              <span class="count">{progress(t)}</span>
            {:else}
              <button class="big-check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete"></button>
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
    </ul>
  </section>
{/each}
```

(The `{#if tasks.length === 0}` empty-state block below stays as-is.)

- [ ] **Step 5: Add drag-handle styling**

In the `<style>` block, add near the `.check, .del, .edit` rule:

```css
.drag {
  cursor: grab;
  color: var(--paper-mute);
  font-size: 1.1rem;
  line-height: 1;
  user-select: none;
  touch-action: none; /* let the library own the drag gesture on touch */
}
.drag:active { cursor: grabbing; }
```

- [ ] **Step 6: Verify typecheck + manual drag**

Run: `npm run check`
Expected: 0 errors.
Manual (dev server, desktop + phone): drag a card by the ⠿ handle within a section — it reorders and the order survives a page reload. Confirm you cannot drag a card into a different section.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/routes/tasks/+page.svelte
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): drag-to-reorder within sections via svelte-dnd-action"
```

---

### Task 6: Big checkbox + Undo toast

**Files:**
- Modify: `src/routes/tasks/+page.svelte`

- [ ] **Step 1: Add snapshot + undo state and handlers**

In `src/routes/tasks/+page.svelte` script, add the undo state and a snapshot helper. Place near the other `$state` declarations:

```ts
import type { CompletionSnapshot } from '$lib/server/maintenance-types';

let undo = $state<{ id: string; snapshot: CompletionSnapshot } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | null = null;

// Pre-completion snapshot of a task. `tickedSubId` (optional) is the sub-item
// just checked that triggered a happening's auto-complete: it must read as done
// so an undo re-checks the whole checklist.
function snapOf(t: MaintenanceTask, tickedSubId?: string): CompletionSnapshot {
  return {
    dueTs: t.dueTs,
    lastCompletedTs: t.lastCompletedTs,
    lastRemindedTs: t.lastRemindedTs,
    enabled: t.enabled,
    subTasks: t.subTasks.map((s) => ({ id: s.id, done: tickedSubId === s.id ? true : s.done })),
  };
}

function showUndo(id: string, snapshot: CompletionSnapshot) {
  undo = { id, snapshot };
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undo = null; }, 6000);
}

async function doUndo() {
  if (!undo) return;
  const { id, snapshot } = undo;
  undo = null;
  if (undoTimer) clearTimeout(undoTimer);
  await fetch(`/api/maintenance/tasks/${id}/uncomplete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  await load();
}
```

- [ ] **Step 2: Capture snapshot on completion paths**

Update `complete` and `toggleSub` to snapshot before mutating and show undo after:

```ts
async function complete(id: string) {
  const t = tasks.find((x) => x.id === id);
  const snapshot = t ? snapOf(t) : null;
  await fetch(`/api/maintenance/tasks/${id}/complete`, { method: 'POST' });
  await load();
  if (snapshot) showUndo(id, snapshot);
}

async function toggleSub(subId: string) {
  const parent = tasks.find((t) => t.subTasks.some((s) => s.id === subId));
  const snapshot = parent ? snapOf(parent, subId) : null;
  const r = await fetch(`/api/maintenance/subtasks/${subId}/toggle`, { method: 'POST' });
  const res = r.ok ? ((await r.json()) as { completed: boolean }) : { completed: false };
  await load();
  if (res.completed && parent && snapshot) showUndo(parent.id, snapshot);
}
```

- [ ] **Step 3: Add the toast markup**

At the end of `<main class="tasks"> … </main>`, just before `</main>`, add:

```svelte
  {#if undo}
    <div class="toast" role="status">
      <span>Completed</span>
      <button onclick={doUndo}>Undo</button>
    </div>
  {/if}
```

- [ ] **Step 4: Style the big checkbox and toast**

In `<style>`, add the big checkbox (replacing reliance on the old `.check` glyph for plain tasks) and the toast. Also bump the sub-item checkbox size:

```css
.big-check {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 2px solid var(--paper-faint);
  background: transparent;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.big-check:hover {
  border-color: var(--moss);
  background: rgba(138, 166, 141, 0.18);
}

.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(86px + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--ink-3);
  border: 1px solid var(--paper-line);
  box-shadow: var(--shadow-1);
  color: var(--paper);
  z-index: 20;
}
.toast button {
  border: 0;
  background: none;
  color: var(--copper);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
}
```

Bump the sub-item checkbox in the existing `.item input[type='checkbox']` rule from `16px` to `20px`:

```css
.item input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--copper); flex-shrink: 0; }
```

- [ ] **Step 5: Verify typecheck + manual undo**

Run: `npm run check`
Expected: 0 errors.
Manual: tap the big checkbox on a recurring task → it completes and reschedules, toast shows "Completed — Undo"; tap Undo → the task returns with its original due date. Repeat for a happening (tick the last sub-item → toast → Undo re-checks the checklist).

- [ ] **Step 6: Commit**

```bash
git add src/routes/tasks/+page.svelte
git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "feat(tasks): big completion checkbox + undo toast"
```

---

## Final verification

- [ ] Run `npm run check` → 0 errors.
- [ ] User runs `npm test` on Windows → all `tests/reorder.test.ts` pass plus the existing suite.
- [ ] Manual smoke on desktop + phone: drag-reorder within each section persists across reload; cross-section drag is blocked; big checkbox completes; Undo restores (both plain task and happening).
