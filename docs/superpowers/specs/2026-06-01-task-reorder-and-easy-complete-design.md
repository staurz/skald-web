# Drag-to-Reorder + Easier Completion — Design

**Date:** 2026-06-01
**Status:** Approved (design), pending spec review

## Goal

Improve how tasks are organized and completed on the Tasks page:

1. **Drag-to-reorder** tasks by hand within each date section, with the order persisted.
2. **Easier completion**: a large tap-target checkbox on plain tasks, plus an **Undo**
   affordance after any completion.

Both changes touch the same files (`tasks/+page.svelte`, the maintenance store, and the
maintenance API), so they ship as one spec/plan.

## Part 1 — Drag-to-reorder

### Behavior

- The page keeps its four automatic sections: **Overdue / Due soon / Upcoming / No date**.
  Sectioning is still derived from each task's due status.
- Within a section, the user can **drag cards to reorder them**. The chosen order is saved
  and overrides the previous due-date sort.
- Dragging is **confined to within a section** — you cannot drag a card into another
  section (that would imply rescheduling, which is explicitly out of scope). The DnD
  library enforces this by giving each section zone a unique `type`.
- A **dedicated drag handle** (⠿ grip) on each card initiates dragging, so it never fights
  the checkbox / expand / edit / delete controls — important on touch.

### Data model

Add one column to `maintenance_task`:

```
sort_order INTEGER NOT NULL DEFAULT 0   -- lower = higher in the list
```

- Declared in `SCHEMA` (for fresh databases) **and** added to the existing
  `MAINTENANCE_TASK_COLUMNS` migration map in `db.ts` (for existing databases), following
  the established pattern.
- **Backfill on first migration:** when the column is newly added to an existing DB, assign
  sequential `sort_order` values in the *current* display order
  (`ORDER BY due_ts IS NULL, due_ts ASC, rowid ASC`) so nothing visually jumps the first
  time. The backfill runs only when the column was just created (detected via the
  pre-ALTER `PRAGMA table_info` set), so it is idempotent.

### Store changes (`maintenance.ts`)

- `listTasks` changes its `ORDER BY` from `due_ts IS NULL, due_ts ASC` to
  `sort_order ASC, rowid ASC`. Sectioning into date buckets happens in the UI; within a
  bucket, cards render in `sort_order` order.
- `createTask` assigns `sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM
  maintenance_task)` so a new task lands at the end (bottom of its section).
- New function `reorderTasks(db, ids: string[])`: in a single transaction, set
  `sort_order = index` for each id in the array. Ignores ids that don't exist. This is
  idempotent and self-healing — no fragile pairwise swaps.

### API

`PUT /api/maintenance/tasks/reorder`

- Body: `{ ids: string[] }` — the **complete** ordered list of all task ids, all four
  sections concatenated top-to-bottom in display order.
- Calls `reorderTasks(openDb(), ids)`, returns `{ ok: true }`.

### Frontend (`tasks/+page.svelte`)

- Add the `svelte-dnd-action` dependency (Svelte 5 action API; small, touch + keyboard +
  aria support built in).
- Each section `<ul>` uses the `dndzone` action with:
  - `items` bound to a **local, mutable per-section array** (kept in sync with the
    derived grouping).
  - a unique `type` per section (the section key) so cards can't cross sections.
  - `dragHandleSelector` set to the grip element (or the documented `dragDisabled` handle
    pattern) so only the handle starts a drag.
- On a zone's `consider` event, update that section's local array (live drag preview). On
  `finalize`, commit the array, rebuild the **global** id list (concat all four sections in
  fixed display order), and `PUT /reorder`. The dropped card stays where it landed
  (optimistic); the next `load()` re-syncs from the server.

## Part 2 — Easier completion

### Big tap-target checkbox

- **Plain task** row becomes: `[⠿ drag] [◯ big checkbox] [title …] [due] [✎] [✕]`. The
  small `✓` button is replaced by a large round checkbox (~28px tap target); one tap
  completes the task.
- **Happening** row is unchanged in completion: `[⠿ drag] [▸ expand] [title] [n/m] [due]
  [✎] [✕]`. Completion still happens by ticking sub-items; the final tick auto-completes
  (existing `toggleSubTask` behavior). No one-tap-all for happenings (per decision).
- Sub-item checkboxes inside a happening are bumped to the same larger size for visual
  consistency.

### Undo

- After **any** completion — a plain task's checkbox tap **or** a happening's final
  sub-item tick that triggers auto-complete — show an inline toast: **"Completed — Undo"**,
  auto-dismissing after ~6 seconds.
- Undo is **stateless on the server**. The page already holds the task's full
  pre-completion state (it was in the loaded `tasks` array). Undo calls a new endpoint with
  that snapshot, and the server restores it.

`POST /api/maintenance/tasks/:id/uncomplete`

- Body: the pre-completion task snapshot (the relevant fields: `dueTs`,
  `lastCompletedTs`, `lastRemindedTs`, `enabled`, and the snapshot's `subTasks` done
  states).
- Calls a new store function `restoreTask(db, id, snapshot)` which, in a transaction:
  - writes back `due_ts`, `last_completed_ts`, `last_reminded_ts`, `enabled` on the task;
  - for each sub-task in the snapshot, restores its `done` value (a completed happening had
    all sub-items done at completion time; a recurring one had them reset to 0, so this
    re-checks them).
- Returns the restored task.

### Why undo matters

Completing a recurring task silently advances its `due_ts` (a year for annual, the interval
otherwise) and clears `last_reminded_ts`; a `once` task is archived (`enabled = 0`). An
accidental tap is otherwise tedious to reverse by hand. Undo makes it one tap back.

## Out of scope

- Cross-section drag / drag-to-reschedule.
- One-tap "complete all" for happenings.
- Swipe-to-complete gestures.
- Reordering sub-items within a happening (they already have `sort_order` in the DB but no
  drag UI — a possible later task).

## Testing

Server-side (Vitest, run on the platform whose `better-sqlite3` binary is active — Windows
for the user's dev):

- Migration adds `sort_order` to a pre-existing old-shape DB and backfills sequential order
  matching the previous display order.
- `listTasks` returns tasks ordered by `sort_order`.
- `createTask` appends with the next `sort_order`.
- `reorderTasks` rewrites `sort_order` to match a given id array; tolerates unknown ids.
- `restoreTask` writes back the snapshot fields and re-checks the snapshot's sub-item done
  states.

Drag interaction and the Undo toast are verified manually in the browser (mouse + touch).
