<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { state }: { state: SpaState | null } = $props();
  let t = $derived(state?.temperatureF);
  let target = $derived(state?.targetTemperatureF);
  let heating = $derived(state?.heating ?? false);

  function fToC(f: number) {
    return Math.round(((f - 32) * 5 / 9) * 10) / 10;
  }
</script>

<div class="rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500">Temperature</h2>
  <div class="flex items-baseline gap-3 mt-2">
    <span class="text-5xl font-bold">{t ?? '—'}<span class="text-2xl">°F</span></span>
    <span class="text-lg text-gray-500">{t != null ? fToC(t) : '—'}°C</span>
  </div>
  <div class="mt-3 text-sm text-gray-500">
    Target: <span class="font-medium">{target ?? '—'}°F</span>
    {#if heating}
      <span class="ml-3 inline-block px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Heating</span>
    {/if}
  </div>
</div>
