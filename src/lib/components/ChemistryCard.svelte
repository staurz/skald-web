<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  export let state: SpaState | null;
  $: c = state?.chemistry;

  function tone(v: number | undefined, lo: number, hi: number): string {
    if (v == null) return 'text-gray-400';
    if (v < lo || v > hi) return 'text-red-600 dark:text-red-400 font-bold';
    return 'text-emerald-600 dark:text-emerald-400 font-bold';
  }
</script>

<div class="rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-3">Water chemistry</h2>
  {#if c}
    <div class="grid grid-cols-2 gap-4 text-center">
      <div>
        <div class="text-xs text-gray-500">pH</div>
        <div class={`text-3xl ${tone(c.ph, 7.2, 7.8)}`}>{c.ph?.toFixed(2) ?? '—'}</div>
      </div>
      <div>
        <div class="text-xs text-gray-500">ORP (mV)</div>
        <div class={`text-3xl ${tone(c.orp, 600, 800)}`}>{c.orp ?? '—'}</div>
      </div>
    </div>
  {:else}
    <div class="text-sm text-gray-400">No data yet</div>
  {/if}
</div>
