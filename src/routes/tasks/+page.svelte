<script lang="ts">
  import { onMount } from 'svelte';
  import { dragHandleZone, dragHandle } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import type { MaintenanceTask, TaskInput, RecurrenceKind, IntervalUnit, CompletionSnapshot } from '$lib/server/maintenance-types';
  // SubTask type is carried inside MaintenanceTask.subTasks; no separate import needed.

  let tasks = $state<MaintenanceTask[]>([]);
  let title = $state('');
  let kind = $state<RecurrenceKind>('once');
  let firstDueDate = $state('');
  let intervalValue = $state(3);
  let intervalUnit = $state<IntervalUnit>('month');
  let annualMonth = $state(10);
  let annualDay = $state(15);
  let editingId = $state<string | null>(null);
  let expanded = $state<Record<string, boolean>>({});
  let newItem = $state<Record<string, string>>({});
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

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  // Days available for the chosen month (Feb shown as 29 so leap-year dates work;
  // the backend clamps non-leap Feb 29 down to the 28th).
  const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let daysInMonth = $derived(MONTH_LENGTHS[annualMonth - 1]);
  $effect(() => {
    if (annualDay > daysInMonth) annualDay = daysInMonth;
  });

  function toggleExpand(id: string) {
    expanded[id] = !expanded[id];
  }

  async function addItem(parentId: string) {
    const t = (newItem[parentId] ?? '').trim();
    if (!t) return;
    const r = await fetch(`/api/maintenance/tasks/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: t }),
    });
    if (r.ok) {
      newItem[parentId] = '';
      expanded[parentId] = true;
      await load();
    }
  }

  async function toggleSub(subId: string) {
    const parent = tasks.find((t) => t.subTasks.some((s) => s.id === subId));
    const snapshot = parent ? snapOf(parent, subId) : null;
    const r = await fetch(`/api/maintenance/subtasks/${subId}/toggle`, { method: 'POST' });
    const res = r.ok ? ((await r.json()) as { completed: boolean }) : { completed: false };
    await load();
    if (res.completed && parent && snapshot) showUndo(parent.id, snapshot);
  }

  async function removeSub(subId: string) {
    await fetch(`/api/maintenance/subtasks/${subId}`, { method: 'DELETE' });
    await load();
  }

  function progress(t: MaintenanceTask): string {
    return `${t.subTasks.filter((s) => s.done).length}/${t.subTasks.length}`;
  }

  // Split a "Hva:/Hvorfor:/Hvordan:" description into labelled parts. Lines
  // without a recognised label render as plain text.
  type DescPart = { label: string; text: string };
  const DESC_LABELS = ['Hva', 'Hvorfor', 'Hvordan'];
  function parseDesc(d: string | null): DescPart[] {
    if (!d) return [];
    return d.split('\n').map((line) => {
      const i = line.indexOf(':');
      const label = i > 0 ? line.slice(0, i).trim() : '';
      return DESC_LABELS.includes(label)
        ? { label, text: line.slice(i + 1).trim() }
        : { label: '', text: line };
    });
  }

  // A task is expandable if it has detail to show (a description or a checklist).
  function hasDetail(t: MaintenanceTask): boolean {
    return !!(t.description && t.description.trim()) || t.subTasks.length > 0;
  }

  async function load() {
    const r = await fetch('/api/maintenance/tasks');
    if (r.ok) tasks = (await r.json()).tasks;
    rebuildSections();
  }
  onMount(load);

  function buildInput(): TaskInput {
    const base: TaskInput = { title, recurrenceKind: kind };
    if (kind === 'once' && firstDueDate) base.firstDueDate = firstDueDate;
    if (kind === 'interval') {
      base.intervalValue = intervalValue;
      base.intervalUnit = intervalUnit;
      if (firstDueDate) base.firstDueDate = firstDueDate;
    }
    if (kind === 'annual') {
      base.annualMonth = annualMonth;
      base.annualDay = annualDay;
    }
    return base;
  }

  function resetForm() {
    editingId = null;
    title = '';
    kind = 'once';
    firstDueDate = '';
    intervalValue = 3;
    intervalUnit = 'month';
    annualMonth = 10;
    annualDay = 15;
  }

  function startEdit(t: MaintenanceTask) {
    editingId = t.id;
    title = t.title;
    kind = t.recurrenceKind;
    intervalValue = t.intervalValue ?? 3;
    intervalUnit = t.intervalUnit ?? 'month';
    annualMonth = t.annualMonth ?? 10;
    annualDay = t.annualDay ?? 15;
    // Prefill the date field from the stored due timestamp (YYYY-MM-DD).
    firstDueDate = t.dueTs === null ? '' : new Date(t.dueTs).toISOString().slice(0, 10);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const url = editingId ? `/api/maintenance/tasks/${editingId}` : '/api/maintenance/tasks';
    const method = editingId ? 'PUT' : 'POST';
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildInput()),
    });
    if (r.ok) {
      resetForm();
      await load();
    }
  }

  async function complete(id: string) {
    const t = tasks.find((x) => x.id === id);
    const snapshot = t ? snapOf(t) : null;
    await fetch(`/api/maintenance/tasks/${id}/complete`, { method: 'POST' });
    await load();
    if (snapshot) showUndo(id, snapshot);
  }

  async function remove(id: string) {
    await fetch(`/api/maintenance/tasks/${id}`, { method: 'DELETE' });
    await load();
  }

  const DAY = 24 * 3600 * 1000;
  function group(t: MaintenanceTask): 'overdue' | 'soon' | 'upcoming' | 'todo' {
    if (t.dueTs === null) return 'todo';
    const now = Date.now();
    if (t.dueTs < now) return 'overdue';
    if (t.dueTs < now + 7 * DAY) return 'soon';
    return 'upcoming';
  }
  const labels = { overdue: 'Overdue', soon: 'Due soon', upcoming: 'Upcoming', todo: 'No date' };

  const FLIP_MS = 150;
  let sections = $state<{ key: 'overdue' | 'soon' | 'upcoming' | 'todo'; label: string; items: MaintenanceTask[] }[]>([]);

  function rebuildSections() {
    sections = (['overdue', 'soon', 'upcoming', 'todo'] as const)
      .map((g) => {
        const items = tasks.filter((t) => group(t) === g);
        // Dated sections are ordered by due date (soonest first). The "No date"
        // bucket keeps its manual sort_order so it stays drag-reorderable.
        if (g !== 'todo') items.sort((a, b) => (a.dueTs ?? 0) - (b.dueTs ?? 0));
        return { key: g, label: labels[g], items };
      })
      .filter((s) => s.items.length > 0);
  }

  // Persist the full top-to-bottom order across all sections.
  function persistOrder() {
    const ids = sections.flatMap((s) => s.items.map((t) => t.id));
    fetch('/api/maintenance/tasks/reorder', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }

  function handleDnd(key: 'overdue' | 'soon' | 'upcoming' | 'todo', items: MaintenanceTask[], commit: boolean) {
    const sec = sections.find((s) => s.key === key);
    if (sec) sec.items = items; // live preview during drag, committed order on finalize
    if (commit) persistOrder();
  }

  function fmtDue(ts: number | null): string {
    if (ts === null) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
  }
</script>

<main class="tasks">
  <h1>Tasks</h1>

  <form class="add" onsubmit={save}>
    <input placeholder="New task…" bind:value={title} aria-label="Task title" />
    <select bind:value={kind} aria-label="Recurrence">
      <option value="once">One-off / todo</option>
      <option value="interval">Repeat every…</option>
      <option value="annual">Every year</option>
    </select>

    {#if kind === 'once'}
      <input type="date" bind:value={firstDueDate} aria-label="Due date (optional)" />
    {:else if kind === 'interval'}
      <input type="number" min="1" bind:value={intervalValue} aria-label="Interval value" />
      <select bind:value={intervalUnit} aria-label="Interval unit">
        <option value="day">days</option>
        <option value="week">weeks</option>
        <option value="month">months</option>
      </select>
      <input type="date" bind:value={firstDueDate} aria-label="First due date (optional)" />
    {:else}
      <span class="when">Every year on</span>
      <select class="date-part" bind:value={annualMonth} aria-label="Month">
        {#each MONTHS as name, i}<option value={i + 1}>{name}</option>{/each}
      </select>
      <select class="date-part" bind:value={annualDay} aria-label="Day">
        {#each Array(daysInMonth) as _, i}<option value={i + 1}>{i + 1}</option>{/each}
      </select>
    {/if}

    <button type="submit">{editingId ? 'Save' : 'Add'}</button>
    {#if editingId}
      <button type="button" class="cancel" onclick={resetForm}>Cancel</button>
    {/if}
  </form>

  {#each sections as section (section.key)}
    <section>
      <h2>{section.label}</h2>
      <ul
        use:dragHandleZone={{ items: section.items, type: section.key, flipDurationMs: FLIP_MS, dropTargetStyle: {}, dragDisabled: section.key !== 'todo' }}
        onconsider={(e) => handleDnd(section.key, e.detail.items, false)}
        onfinalize={(e) => handleDnd(section.key, e.detail.items, true)}
      >
        {#each section.items as t (t.id)}
          <li class={group(t)} animate:flip={{ duration: FLIP_MS }}>
            <div class="row">
              {#if section.key === 'todo'}<span class="drag" use:dragHandle aria-label="Drag to reorder" title="Drag to reorder">⠿</span>{/if}
              {#if hasDetail(t)}
                <button class="check chev" title="Show details" onclick={() => toggleExpand(t.id)} aria-label="Show details" aria-expanded={!!expanded[t.id]}>{expanded[t.id] ? '▾' : '▸'}</button>
              {:else}
                <button class="big-check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete"></button>
              {/if}
              <span class="title">{t.title}</span>
              {#if t.subTasks.length > 0}<span class="count">{progress(t)}</span>{/if}
              {#if t.dueTs !== null}<span class="due">{fmtDue(t.dueTs)}</span>{/if}
              {#if t.subTasks.length === 0 && hasDetail(t)}
                <button class="big-check" title="Complete" onclick={() => complete(t.id)} aria-label="Complete"></button>
              {/if}
              <button class="edit" title="Edit" onclick={() => startEdit(t)} aria-label="Edit">✎</button>
              <button class="del" title="Delete" onclick={() => remove(t.id)} aria-label="Delete">✕</button>
            </div>

            {#if expanded[t.id] && hasDetail(t)}
              <div class="detail">
                {#if t.description}
                  <div class="desc">
                    {#each parseDesc(t.description) as part}
                      {#if part.label}
                        <div class="dl"><span class="dt">{part.label}</span><span class="dd">{part.text}</span></div>
                      {:else}
                        <p class="dp">{part.text}</p>
                      {/if}
                    {/each}
                  </div>
                {/if}

                {#if t.subTasks.length > 0}
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
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if tasks.length === 0}
    <p class="empty">No tasks yet.</p>
  {/if}

  {#if undo}
    <div class="toast" role="status">
      <span>Completed</span>
      <button onclick={doUndo}>Undo</button>
    </div>
  {/if}
</main>

<style>
  .tasks { display: flex; flex-direction: column; gap: 20px; }
  h1 {
    font-family: var(--display);
    font-variation-settings: 'opsz' 36, 'SOFT' 60, 'wght' 420;
    font-size: 1.5rem;
    color: var(--paper);
    margin: 0;
  }
  h2 {
    font-family: var(--mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--paper-mute);
    margin: 0 0 10px;
  }

  .add { display: flex; flex-wrap: wrap; gap: 8px; }
  .add input, .add select {
    padding: 10px 12px;
    border-radius: var(--r-sm);
    border: 1px solid var(--paper-faint);
    background: rgba(243, 237, 224, 0.06);
    color: var(--paper);
    font: inherit;
  }
  .when {
    align-self: center;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }
  .add input::placeholder { color: var(--paper-mute); }
  .add input:focus, .add select:focus { outline: none; border-color: var(--copper); }
  /* Native dropdown list: the popped-open options use their own background,
     so give them a solid dark surface + cream text for readable contrast. */
  .add select option { background: var(--ink-2); color: var(--paper); }
  .add input:not([type]) { flex: 1 1 160px; }
  .add button {
    padding: 10px 18px;
    border-radius: 999px;
    border: 0;
    background: var(--copper);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .add button.cancel {
    background: transparent;
    color: var(--paper-soft);
    border: 1px solid var(--paper-faint);
  }

  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  li {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--r-md);
    background: linear-gradient(180deg, rgba(26, 43, 68, 0.62), rgba(18, 32, 53, 0.86));
    border: 1px solid var(--paper-line);
    box-shadow: var(--shadow-1);
  }
  li.overdue { border-left: 3px solid var(--rust); }
  .row { display: flex; align-items: center; gap: 10px; }
  .title { flex: 1; font-family: var(--display); font-size: 1.02rem; color: var(--paper); }
  .count { font-family: var(--mono); font-size: 0.72rem; color: var(--copper); letter-spacing: 0.08em; }
  .due { font-family: var(--mono); font-size: 0.66rem; color: var(--paper-mute); letter-spacing: 0.08em; }
  .check, .del, .edit {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 1.05rem;
    color: var(--paper-soft);
    transition: color 0.25s;
  }
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
  .drag {
    cursor: grab;
    color: var(--paper-mute);
    font-size: 1.1rem;
    line-height: 1;
    user-select: none;
    touch-action: none; /* let the library own the drag gesture on touch */
  }
  .drag:active { cursor: grabbing; }
  .check:hover { color: var(--moss); }
  .edit:hover { color: var(--copper); }
  .del:hover { color: var(--rust); }
  .empty { color: var(--paper-mute); }

  .chev { font-size: 0.9rem; }

  .detail { margin: 2px 0 0 26px; display: flex; flex-direction: column; gap: 12px; }
  .desc { display: flex; flex-direction: column; gap: 7px; }
  .dl {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 10px;
    align-items: baseline;
  }
  .dt {
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--copper);
    padding-top: 2px;
  }
  .dd { font-size: 0.88rem; line-height: 1.45; color: var(--paper-soft); }
  .dp { margin: 0; font-size: 0.88rem; line-height: 1.45; color: var(--paper-soft); }

  .items { display: flex; flex-direction: column; gap: 9px; }
  .item { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: var(--paper); }
  .item input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--copper); flex-shrink: 0; }
  .item span.done { text-decoration: line-through; color: var(--paper-mute); }
  .del.small { font-size: 0.85rem; margin-left: auto; color: var(--paper-mute); }
  .add-item input {
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    border: 1px solid var(--paper-faint);
    background: rgba(243, 237, 224, 0.05);
    color: var(--paper);
    font: inherit;
  }
  .add-item input::placeholder { color: var(--paper-mute); }
  .add-item input:focus { outline: none; border-color: var(--copper); }
</style>
