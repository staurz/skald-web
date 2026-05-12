<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import HistoryChart from '$lib/components/HistoryChart.svelte';

  type Pt = { ts_bucket: number; avg: number; min: number; max: number; sample_count: number };

  let temp = $state<Pt[]>([]);
  let target = $state<Pt[]>([]);
  let ph = $state<Pt[]>([]);
  let orp = $state<Pt[]>([]);
  let loaded = $state(false);

  async function fetchMetric(name: string): Promise<Pt[]> {
    const r = await fetch(`/api/history?metric=${name}&from=${Date.now() - 24 * 3600 * 1000}`);
    if (!r.ok) return [];
    return (await r.json()).points;
  }

  onMount(async () => {
    const [t, tt, p, o] = await Promise.all([
      fetchMetric('temperatureF'),
      fetchMetric('targetTemperatureF'),
      fetchMetric('ph'),
      fetchMetric('orp'),
    ]);
    temp = t;
    target = tt;
    ph = p;
    orp = o;
    loaded = true;
  });

  function bucketCount() {
    return Math.max(temp.length, target.length, ph.length, orp.length);
  }
</script>

<main class="app">
  <header class="topbar">
    <a class="mark" href="/">
      Skålda<span class="mark-dot"></span>
    </a>
    <nav class="nav">
      <a href="/" class:active={$page.url.pathname === '/'}>Now</a>
      <a href="/history" class:active={$page.url.pathname === '/history'}>History</a>
      <a href="/alerts" class:active={$page.url.pathname === '/alerts'}>Alerts</a>
    </nav>
  </header>

  <section class="hero" style="margin-bottom:48px;">
    <div class="hero-label">
      History · last 24 hours
      <span class="timestamp">{loaded ? `${bucketCount()} 5-min buckets` : 'loading…'}</span>
    </div>
  </section>

  <section class="card">
    <div class="card-label">
      Temperature
      <span class="stamp">°F</span>
    </div>
    <HistoryChart points={temp} yLabel="°F" />
  </section>

  <section class="card">
    <div class="card-label">
      Target temperature
      <span class="stamp">°F</span>
    </div>
    <HistoryChart points={target} yLabel="°F" />
  </section>

  <section class="card">
    <div class="card-label">
      pH
      <span class="stamp">7.2 — 7.8</span>
    </div>
    <HistoryChart points={ph} yLabel="pH" />
  </section>

  <section class="card">
    <div class="card-label">
      ORP
      <span class="stamp">600 — 800 mV</span>
    </div>
    <HistoryChart points={orp} yLabel="mV" />
  </section>

  <div class="footer-stamp">24 h window · 5 min buckets</div>
</main>
