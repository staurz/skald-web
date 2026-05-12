<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { state }: { state: SpaState | null } = $props();
  let pumps = $derived(state?.pumps ?? []);
  let blower = $derived(state?.blower ?? false);
  let lights = $derived(state?.lights ?? false);

  function pumpBg(speed: 0 | 1 | 2) {
    return speed === 0
      ? 'bg-gray-200 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500'
      : speed === 1
      ? 'bg-sky-400 text-white'
      : 'bg-sky-700 text-white';
  }
</script>

<div class="rounded-2xl border border-gray-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
  <h2 class="text-sm uppercase tracking-wider text-gray-500 mb-3">Accessories</h2>
  <div class="grid grid-cols-3 gap-3">
    {#each pumps as p (p.id)}
      <div class={`rounded-xl p-4 text-center font-semibold ${pumpBg(p.speed)}`}>
        Pump {p.id}<br /><span class="text-xs opacity-80">speed {p.speed}</span>
      </div>
    {/each}
    <div
      class={`rounded-xl p-4 text-center font-semibold ${
        blower ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500'
      }`}
    >
      Blower
    </div>
    <div
      class={`rounded-xl p-4 text-center font-semibold ${
        lights ? 'bg-yellow-300 text-yellow-900' : 'bg-gray-200 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500'
      }`}
    >
      Lights
    </div>
  </div>
</div>
