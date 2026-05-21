<script lang="ts">
  import { onMount } from 'svelte';
  import HistoryChart from '$lib/components/HistoryChart.svelte';
  import { spaState } from '$lib/client/state-store';
  import { fToC } from '$lib/util/units';

  type Pt = { ts_bucket: number; avg: number; min: number; max: number; sample_count: number };

  let history = $state({
    points: [] as number[],
    high: null as number | null,
    low: null as number | null,
    avg: null as number | null,
    sessions: [0, 0, 0, 0, 0, 0, 0],
  });

  onMount(async () => {
    try {
      const r = await fetch(`/api/history?metric=temperatureF&from=${Date.now() - 24 * 3600 * 1000}`);
      if (!r.ok) return;
      const data = await r.json();
      const pts = (data.points ?? []) as Pt[];
      const tempsC = pts.map((p) => fToC(p.avg));
      if (tempsC.length > 0) {
        history = {
          points: tempsC,
          high: Math.max(...tempsC),
          low: Math.min(...tempsC),
          avg: tempsC.reduce((s, v) => s + v, 0) / tempsC.length,
          sessions: history.sessions,
        };
      }
    } catch (_) {
      /* empty chart is acceptable */
    }
  });

  function fmt(n: number | null) {
    return n == null ? '—' : n.toFixed(1).replace('.', ',') + '°';
  }

  let target = $derived($spaState?.targetTemperatureF != null ? fToC($spaState.targetTemperatureF) : undefined);
</script>

<svelte:head>
  <title>Skålda — History</title>
</svelte:head>

<header class="page-head anim-rise">
  <div class="page-label">Last 24 hours · Temperature</div>
  <h1 class="display-h">History</h1>
</header>

<section class="card anim-rise" style="animation-delay: 180ms; padding: 18px 14px;">
  <HistoryChart points={history.points} {target} label="TEMPERATURE 24H" />
  <div class="x-ticks">
    <span>−23H</span><span>−18H</span><span>−12H</span><span>−6H</span><span>NOW</span>
  </div>
</section>

<div class="stat-grid anim-rise" style="animation-delay: 260ms;">
  {#each [
    { label: 'HIGH', value: fmt(history.high) },
    { label: 'LOW',  value: fmt(history.low) },
    { label: 'AVG',  value: fmt(history.avg) }
  ] as s}
    <div class="card stat">
      <div class="page-label">{s.label}</div>
      <div class="stat-num">{s.value}</div>
    </div>
  {/each}
</div>

<section class="anim-rise" style="animation-delay: 340ms;">
  <div class="page-label sessions-head">Sessions · 7 days</div>
  <div class="card sessions">
    <div class="bars">
      {#each history.sessions as h, i}
        <div class="bar-col">
          <div
            class="bar"
            class:on={h > 0}
            style="height: {(h / 90) * 44 + 3}px;"
          ></div>
          <div class="bar-label">{'MTWTFSS'[i]}</div>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .page-head {
    margin-top: 8px;
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
  .page-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }

  .x-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    padding: 0 2px;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    color: var(--paper-faint);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-top: 14px;
  }
  .stat {
    padding: 14px 14px;
  }
  .stat-num {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 60, 'wght' 280, 'SOFT' 60;
    font-size: 1.7rem;
    color: var(--paper);
    letter-spacing: -0.03em;
    margin-top: 4px;
  }

  .sessions-head {
    margin: 18px 0 10px;
  }
  .sessions {
    padding: 16px 14px;
  }
  .bars {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    align-items: end;
    height: 64px;
  }
  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .bar {
    width: 60%;
    background: var(--paper-line);
    border-radius: 3px;
    opacity: 0.5;
    transition: background 0.4s;
  }
  .bar.on {
    background: var(--copper);
    box-shadow: 0 0 10px var(--copper-dim);
    opacity: 1;
  }
  .bar-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    color: var(--paper-faint);
  }
</style>
