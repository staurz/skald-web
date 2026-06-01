# Task Happenings (grouped checklists) — Design

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Builds on:** `2026-06-01-house-maintenance-design.md`

## Summary

Let a maintenance task hold a checklist of sub-tasks, turning it into a
"happening" — e.g. **Vinterforberedelse** (annual, ~October) containing
*plukk inn robotklipperne*, *vinterlagre verktøy*, *gå over takrenner*. You tick
items off as you do them; when the last one is ticked the happening
auto-completes (recurring ones reschedule and reset the checklist).

Personal, single-user app. Scheduling lives on the parent (decided during
brainstorming); sub-tasks are a plain checklist with no dates of their own.

## Core model

- A **happening** is simply any `maintenance_task` that has ≥1 sub-task. There is
  no separate task type or flag — a task with no sub-tasks is a plain task and
  behaves exactly as today.
- The parent keeps its existing recurrence (`once` / `interval` / `annual`),
  `due_ts`, and reminder behavior. The hourly reminder loop is **unchanged** —
  the parent reminds when due; sub-tasks never remind.

## Data model

One new table:

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

`ON DELETE CASCADE` cleans up children when a parent is deleted. Because
better-sqlite3 does not enable FK enforcement by default, `deleteTask` also
explicitly deletes a task's sub-tasks (belt-and-braces); we additionally enable
`PRAGMA foreign_keys = ON` in `openDb`.

## Behavior

### Ticking an item
Toggling a sub-task flips its `done`. After a toggle, if the parent has ≥1
sub-task and **all** are `done`, the happening **auto-completes**:

- Reuse the existing `completeTask(parent, now)` logic:
  - recurring (`interval`/`annual`) → set next `due_ts`, reset `last_reminded_ts`.
  - `once` → archive (`enabled = 0`).
- For a recurring parent, **reset all its sub-tasks to `done = 0`** so the
  checklist is fresh for the next occurrence. For an archived `once` parent,
  leave sub-tasks as-is (they record what was done).

Auto-complete only fires for tasks that actually have sub-tasks; plain tasks are
unaffected.

### Completion UI rule
A happening has **no manual ✓ complete button** — completion is checklist-driven
(per the brainstorming decision). Plain tasks keep their ✓ button. Edit and
delete remain available on both.

## API

- `GET /api/maintenance/tasks` — unchanged URL, but each task now includes a
  nested `subTasks: SubTask[]` (ordered by `sort_order`, then insertion).
- `POST /api/maintenance/tasks/[id]/subtasks` — body `{ title }` → adds a
  sub-task to the parent (appended at the end). Returns the created sub-task.
- `POST /api/maintenance/subtasks/[subId]/toggle` — flips `done`, runs the
  auto-complete check, returns `{ completed: boolean }` (whether the toggle
  completed the happening).
- `DELETE /api/maintenance/subtasks/[subId]` — removes a sub-task.

All under the existing access gate (not allowlisted), like the rest of
`/api/maintenance/*`.

## Types

```ts
export interface SubTask {
  id: string;
  parentId: string;
  title: string;
  done: boolean;
  sortOrder: number;
}
```

`MaintenanceTask` gains `subTasks: SubTask[]` (populated by `listTasks`; empty
for plain tasks).

## Store functions (src/lib/server/maintenance.ts)

- `listTasks(db)` — now also fetches sub-tasks and attaches them per task
  (single extra query, grouped in memory by `parent_id`).
- `addSubTask(db, parentId, title)` → `SubTask` (computes next `sort_order`).
- `toggleSubTask(db, subId, now)` → `{ completed: boolean }`. Flips `done`; if
  all siblings are now done, calls `completeTask(parent, now)` and, when the
  parent remains active (recurring), resets the siblings' `done` to 0.
- `deleteSubTask(db, subId)`.
- `deleteTask(db, id)` — also deletes the task's sub-tasks.

## UI (src/routes/tasks/+page.svelte)

- A task with `subTasks.length > 0` renders as an **expandable happening**:
  title, a progress badge (e.g. `2/5`), and — when expanded — the checklist of
  checkboxes plus an inline "+ add item" input. Toggling a checkbox calls the
  toggle endpoint and reloads; when it reports `completed`, the reload reflects
  the reschedule/reset.
- A plain task (no sub-tasks) renders exactly as today, including its ✓ button.
- Creating a happening: add a normal task (e.g. annual "Vinterforberedelse"),
  then add items to it via its "+ add item" input — it becomes a happening
  automatically. No separate dedicated form.

## Error handling

- API validates non-empty `title` (400 otherwise) and returns 404 for unknown
  ids. Follows existing endpoint patterns.
- `toggleSubTask`/`addSubTask` are no-ops returning safely if the parent/sub-task
  is missing.

## Testing (vitest, temp DB)

- sub-task CRUD: add appends with increasing `sort_order`; delete removes;
  `listTasks` nests children under the right parent and leaves plain tasks with
  an empty array.
- toggle: flips `done`; partial completion does **not** auto-complete.
- **auto-complete**: ticking the last item of a recurring happening reschedules
  the parent (`due_ts` advances) AND resets all sub-tasks to `done = 0`; for a
  `once` happening it archives the parent and leaves sub-tasks intact.
- `deleteTask` removes the parent's sub-tasks.

## Out of scope (YAGNI for this iteration)

- Per-item due dates / reminders (scheduling stays on the parent).
- Reordering items via drag (insertion order only; `sort_order` exists for future
  use).
- Templated/pre-filled happenings (could layer on later).
