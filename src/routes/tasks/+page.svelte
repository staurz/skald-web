<script lang="ts">
  import { onMount } from 'svelte';
  import type { MaintenanceTask, TaskInput, RecurrenceKind, IntervalUnit } from '$lib/server/maintenance-types';
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
    await fetch(`/api/maintenance/subtasks/${subId}/toggle`, { method: 'POST' });
    await load();
  }

  async function removeSub(subId: string) {
    await fetch(`/api/maintenance/subtasks/${subId}`, { method: 'DELETE' });
    await load();
  }

  function progress(t: MaintenanceTask): string {
    return `${t.subTasks.filter((s) => s.done).length}/${t.subTasks.length}`;
  }

  async function load() {
    const r = await fetch('/api/maintenance/tasks');
    if (r.ok) tasks = (await r.json()).tasks;
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
    await fetch(`/api/maintenance/tasks/${id}/complete`, { method: 'POST' });
    await load();
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

  let grouped = $derived(
    (['overdue', 'soon', 'upcoming', 'todo'] as const).map((g) => ({
      key: g,
      label: labels[g],
      items: tasks.filter((t) => group(t) === g),
    })).filter((s) => s.items.length > 0),
  );

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
      <input type="number" min="1" max="12" bind:value={annualMonth} aria-label="Month" />
      <input type="number" min="1" max="31" bind:value={annualDay} aria-label="Day" />
    {/if}

    <button type="submit">{editingId ? 'Save' : 'Add'}</button>
    {#if editingId}
      <button type="button" class="cancel" onclick={resetForm}>Cancel</button>
    {/if}
  </form>

  {#each grouped as section (section.key)}
    <section>
      <h2>{section.label}</h2>
      <ul>
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
      </ul>
    </section>
  {/each}

  {#if tasks.length === 0}
    <p class="empty">No tasks yet.</p>
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
  .check:hover { color: var(--moss); }
  .edit:hover { color: var(--copper); }
  .del:hover { color: var(--rust); }
  .empty { color: var(--paper-mute); }

  .items { margin: 2px 0 0 26px; display: flex; flex-direction: column; gap: 9px; }
  .item { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: var(--paper); }
  .item input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--copper); flex-shrink: 0; }
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
