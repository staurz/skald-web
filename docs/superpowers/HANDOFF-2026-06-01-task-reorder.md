# Handoff — Drag-to-Reorder + Easier Completion

**Date:** 2026-06-01
**Branch:** `feat/task-reorder-complete` (cut from `main`)
**Execution method:** superpowers subagent-driven-development (fresh implementer per task + spec review + code-quality review)

## What we're building

Two changes to the Tasks page (`/tasks`), one spec, one plan:

1. **Drag-to-reorder** tasks by hand within each date section (Overdue / Due soon / Upcoming / No date), persisted via a new `sort_order` column. Within-section only (unique dnd `type` per section); a `.drag` grip handle. Uses `svelte-dnd-action` (touch + keyboard).
2. **Easier completion**: a big round tap-target checkbox on plain tasks (+ bigger sub-item checkboxes), and an **Undo** toast after any completion (stateless restore via a client-held snapshot).

- **Spec:** `docs/superpowers/specs/2026-06-01-task-reorder-and-easy-complete-design.md` (committed `b49f64d`)
- **Plan:** `docs/superpowers/plans/2026-06-01-task-reorder-and-easy-complete.md` (6 tasks, full code in each step)

## Progress

| Task | What | Status |
|------|------|--------|
| **T1** | `sort_order` column in `db.ts` SCHEMA + `MAINTENANCE_TASK_COLUMNS` + order-preserving backfill in `migrate()`; `tests/reorder.test.ts` migration test; added `sort_order` to the column-snapshot test in `tests/maintenance.test.ts` | ✅ Done, reviewed (spec ✅, code ✅), committed `1371601` |
| **T2** | `listTasks` orders by `sort_order ASC, rowid ASC`; `createTask` appends with `MAX(sort_order)+1`; new `reorderTasks(db, ids)`; 3 tests in `reorder.test.ts` | ⚠️ Implemented + committed `ddf464e`, but **spec + code-quality reviews NOT yet run** — resume here |
| **T3** | `PUT /api/maintenance/tasks/reorder/+server.ts` (body `{ ids: string[] }` → `reorderTasks`) | ⬜ Not started |
| **T4** | `CompletionSnapshot` type; `restoreTask(db, id, snap)`; `POST /api/maintenance/tasks/[id]/uncomplete/+server.ts`; 2 tests in `reorder.test.ts` | ⬜ Not started |
| **T5** | `npm install svelte-dnd-action`; `+page.svelte` sections → dnd zones with drag handle | ⬜ Not started |
| **T6** | `+page.svelte` big checkbox + bigger sub-checkboxes + undo toast wired to `/uncomplete` | ⬜ Not started |

Internal task tracker IDs: #21 (T1, completed) … #26 (T6). #22 left in_progress.

## Resume instructions (tomorrow)

1. Re-enter `superpowers:subagent-driven-development`.
2. **Finish T2's review loop first** (it's committed but unreviewed): dispatch a spec-compliance reviewer then a code-quality reviewer against commit `ddf464e` (`git show ddf464e`). If clean, mark #22 done.
3. Continue T3 → T4 → T5 → T6, each: implementer → spec review → code review.
4. After T6: final whole-branch code review, then `superpowers:finishing-a-development-branch`.

## Hard constraints (don't relearn these the hard way)

- **better-sqlite3 binary is Windows-built.** Under WSL (where subagents run) `npm test` CANNOT load it ("not a valid Win32 application" / ERR_DLOPEN) — environmental, not a code bug. Subagents validate with `npm run check` (platform-independent, must be 0 errors); **the user runs `npm test` on Windows** to confirm DB-test logic. Do NOT rebuild/reinstall the binary.
- **Git identity:** commit with inline flags — `git -c user.name="Emil Staurset" -c user.email="emil.staurset@miles.no" commit -m "..."` (`.git/config` write and `--global` both fail in this env).
- **Dev server (per memory):** disable sandbox + `--host 0.0.0.0` when starting `npm run dev` from WSL, or Windows browser gets connection refused. First load is slow (~1 min Vite optimize).
- **Harness LSP diagnostics can be stale** — trust `npm run check`, not the inline red squiggles, when they disagree.

## ⚠️ Outstanding test verification

`tests/reorder.test.ts` (T1 + T2 tests) and the edited `tests/maintenance.test.ts` have only been typechecked under WSL. **Run `npm test` on Windows** to confirm all pass (the whole suite, including the new `seed-maintenance.test.ts` from `ea428ba`). Expected for reorder: migration backfills [a,b,c]→[0,1,2]; `createTask` appends; `reorderTasks` rewrites order and tolerates unknown ids.

## Branch history (as of handoff)

```
1ca7d21 docs: implementation plan + handoff           (this feature's docs)
ea428ba feat(maintenance): seed house tasks ...        (separate feature — see note)
ddf464e feat(tasks): order tasks by sort_order ...     (T2)
1371601 feat(tasks): add sort_order column ...         (T1)
b49f64d docs: spec for drag-to-reorder ...             (this feature's spec)
```

## Note: `ea428ba` is a SEPARATE feature that landed on this branch

`ea428ba feat(maintenance): seed house tasks with what/why/how detail` was committed (by the user, in their own terminal) partway through today and is **unrelated to drag-reorder/complete**. It bundled:
- `scripts/seed-maintenance.mjs` + `tests/seed-maintenance.test.ts` + a `seed` npm script;
- descriptive-metadata fields (`description/category/source/priority/season/estimatedMinutes/costEstimate/seedKey`) in `maintenance-types.ts`;
- **and my "Every year on" annual date-picker edit** to `src/routes/tasks/+page.svelte` (month-name dropdown + day dropdown replacing the two bare number inputs), plus the descriptive-metadata `parseDesc`/`hasDetail` rendering — all in the same commit.

Implications for resuming:
- It's fine; the working tree is now **clean**. No untangling needed — `+page.svelte` already contains the date-picker baseline that T5/T6 build on.
- If you ever want this branch to be *only* the reorder/complete feature (e.g. to PR it cleanly), `ea428ba` would need to be split out — but that's optional and not blocking. Simplest is to keep going and let both ride together, or land `ea428ba` to `main` separately later.
- The current `+page.svelte` baseline T5/T6 must edit already has: the annual date-picker, and `parseDesc`/`hasDetail` happening-detail rendering. T5/T6's plan code was written against the earlier layout — the implementer must read the **current** file and integrate, not blindly paste.

Untracked dirs left alone: `.claude/`, `.idea`, `.vscode`, `shipping-glod/` (editor/config + one unknown dir — ignore).
