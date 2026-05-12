<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  import { fToC } from '$lib/util/units';

  let { state }: { state: SpaState | null } = $props();
  let tC = $derived(state?.temperatureF != null ? fToC(state.temperatureF) : undefined);
  let targetC = $derived(state?.targetTemperatureF != null ? fToC(state.targetTemperatureF) : undefined);
  let heating = $derived(state?.heating ?? false);
  let ts = $derived(state?.ts);

  function relativeStamp(updatedAt?: number): string {
    if (!updatedAt) return 'connecting…';
    const secs = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
    if (secs < 5) return 'just now';
    if (secs < 60) return `updated ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `updated ${hrs}h ago`;
  }

  let stamp = $derived(relativeStamp(ts));
</script>

<section class="hero">
  <div class="hero-label">
    Water temperature
    <span class="timestamp">{stamp}</span>
  </div>
  <div class="hero-number">
    <span>{tC ?? '—'}</span><span class="hero-unit">°C</span>
  </div>
  <div class="hero-meta">
    <span class="hero-target">
      <span class="hero-target-label">Target</span>
      <span class="hero-target-num">{targetC ?? '—'}°C</span>
    </span>
    {#if heating}
      <span class="hero-status">Heating</span>
    {/if}
  </div>
</section>
