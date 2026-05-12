<script lang="ts">
  import { onMount } from 'svelte';
  import HistoryChart from '$lib/components/HistoryChart.svelte';

  type Pt = { ts_bucket: number; avg: number; min: number; max: number; sample_count: number };

  let temp = $state<Pt[]>([]);
  let target = $state<Pt[]>([]);
  let ph = $state<Pt[]>([]);
  let orp = $state<Pt[]>([]);

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
  });
</script>

<main class="max-w-3xl mx-auto p-4 space-y-6">
  <header class="flex items-center justify-between mb-2">
    <h1 class="text-xl font-bold">History (last 24h)</h1>
    <a href="/" class="text-sm hover:underline">← Dashboard</a>
  </header>

  <section>
    <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-1">Temperature (°F)</h2>
    <HistoryChart points={temp} yLabel="°F" />
  </section>
  <section>
    <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-1">Target temperature (°F)</h2>
    <HistoryChart points={target} yLabel="°F" />
  </section>
  <section>
    <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-1">pH</h2>
    <HistoryChart points={ph} yLabel="pH" />
  </section>
  <section>
    <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-1">ORP (mV)</h2>
    <HistoryChart points={orp} yLabel="mV" />
  </section>
</main>
