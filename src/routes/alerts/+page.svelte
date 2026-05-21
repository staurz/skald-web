<script lang="ts">
  import { onMount } from 'svelte';
  import AlertItem from '$lib/components/AlertItem.svelte';

  type Kind = 'info' | 'warn' | 'alert';
  type AlertRow = {
    id: number | string;
    kind: Kind;
    title: string;
    detail?: string;
    time: string;
    date: string;
  };

  let alerts = $state<AlertRow[]>([]);
  let counts = $derived({
    flagged: alerts.filter((a) => a.kind !== 'info').length,
    info: alerts.filter((a) => a.kind === 'info').length,
  });

  let groups = $derived.by(() => {
    const out: { date: string; items: AlertRow[] }[] = [];
    const idx = new Map<string, number>();
    for (const a of alerts) {
      if (!idx.has(a.date)) {
        idx.set(a.date, out.length);
        out.push({ date: a.date, items: [] });
      }
      out[idx.get(a.date)!].items.push(a);
    }
    return out;
  });

  onMount(async () => {
    try {
      const r = await fetch('/api/alerts');
      if (r.ok) {
        const data = await r.json();
        alerts = (data.alerts ?? data ?? []).map((x: any, i: number) => ({
          id: x.id ?? i,
          kind: (x.kind ?? x.severity ?? 'info') as Kind,
          title: x.title ?? x.message ?? 'Alert',
          detail: x.detail ?? x.description,
          time: x.time ?? formatTime(x.ts),
          date: x.date ?? formatDate(x.ts),
        }));
      }
    } catch (_) {
      /* empty list is the correct rendering */
    }
  });

  function formatTime(ts?: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function formatDate(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
</script>

<svelte:head>
  <title>Skålda — Alerts</title>
</svelte:head>

<header class="page-head anim-rise">
  <div class="page-label">
    <span>{counts.flagged} need review · {counts.info} info</span>
    <a href="/alerts/rules" class="rules-link">Manage rules →</a>
  </div>
  <h1 class="display-h">Alerts</h1>
</header>

{#if alerts.length === 0}
  <section class="card anim-rise" style="animation-delay: 180ms; text-align: center;">
    <div class="empty-mark"></div>
    <p class="empty-title">Nothing pressing</p>
    <p class="empty-detail">Alerts and changes will show up here once they happen.</p>
  </section>
{:else}
  <div class="groups">
    {#each groups as g, gi}
      <div class="group anim-rise" style="animation-delay: {180 + gi * 60}ms;">
        <div class="group-date">{g.date}</div>
        <div class="list">
          {#each g.items as a (a.id)}
            <AlertItem kind={a.kind} title={a.title} detail={a.detail} time={a.time} />
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .page-head {
    margin-top: 8px;
  }
  .page-label {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px 12px;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }
  .rules-link {
    color: var(--copper);
    text-decoration: none;
  }
  .rules-link:hover {
    color: var(--paper);
  }
  .display-h {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 96, 'wght' 280, 'SOFT' 80;
    font-size: clamp(3.4rem, 14vw, 5rem);
    color: var(--paper);
    line-height: 0.88;
    letter-spacing: -0.035em;
    margin: 4px 0 22px;
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .group-date {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 50;
    font-size: 0.95rem;
    color: var(--paper-soft);
    margin-bottom: 8px;
    padding-left: 2px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-mark {
    width: 10px;
    height: 10px;
    background: var(--moss);
    border-radius: 50%;
    margin: 8px auto 14px;
    box-shadow: 0 0 14px rgba(138, 166, 141, 0.5);
  }
  .empty-title {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 24, 'wght' 500, 'SOFT' 70;
    font-size: 1.15rem;
    color: var(--paper);
    margin: 0;
  }
  .empty-detail {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 50;
    font-size: 0.9rem;
    color: var(--paper-soft);
    margin: 6px 0 0;
  }
</style>
