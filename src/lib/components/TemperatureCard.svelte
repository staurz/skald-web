<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { state }: { state: SpaState | null } = $props();
  let t = $derived(state?.temperatureF);
  let target = $derived(state?.targetTemperatureF);
  let heating = $derived(state?.heating ?? false);
  let ts = $derived(state?.ts);

  function fToC(f: number) {
    return Math.round(((f - 32) * 5 / 9) * 10) / 10;
  }

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
    <span>{t ?? '—'}</span><span class="hero-unit">°F</span>
  </div>
  <div class="hero-celsius">{t != null ? `${fToC(t)} °C` : '— °C'}</div>
  <div class="hero-meta">
    <span class="hero-target">
      <span class="hero-target-label">Target</span>
      <span class="hero-target-num">{target ?? '—'}°F</span>
    </span>
    {#if heating}
      <span class="hero-status">Heating</span>
    {/if}
  </div>
</section>
