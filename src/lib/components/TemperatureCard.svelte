<script lang="ts">
  import type { SpaState } from '$lib/server/types';
  import { fToC } from '$lib/util/units';
  import StatusPill from './StatusPill.svelte';

  let { state }: { state: SpaState | null } = $props();

  let tC = $derived(state?.temperatureF != null ? fToC(state.temperatureF) : undefined);
  let targetC = $derived(state?.targetTemperatureF != null ? fToC(state.targetTemperatureF) : undefined);
  let heating = $derived(state?.heating ?? false);
  let ts = $derived(state?.ts);

  let pill = $derived(heating
    ? { variant: 'heating' as const, label: 'Heating' }
    : { variant: 'ready' as const, label: 'Ready' });

  let parts = $derived(
    tC == null
      ? ['—', null]
      : (() => {
          const s = tC.toFixed(1).replace('.', ',');
          const [i, d] = s.split(',');
          return [i, d];
        })()
  );

  let heatingDelta = $derived(
    heating && tC != null && targetC != null ? (targetC - tC).toFixed(1).replace('.', ',') : null
  );

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

<section class="hero anim-rise">
  <div class="hero-top">
    <StatusPill variant={pill.variant} label={pill.label} pulse={heating} />
    <span class="stamp">{stamp}</span>
  </div>

  <div class="number">
    <span class="int anim-settle">{parts[0]}</span>{#if parts[1] != null}<span class="dec">,{parts[1]}</span>{/if}<span class="unit">°C</span>
  </div>

  <div class="target">
    <span class="target-label">target</span>
    <span class="target-num">{targetC != null ? targetC.toFixed(1).replace('.', ',') : '—'}°C</span>
    {#if heatingDelta != null}
      <span class="delta">Δ {heatingDelta}</span>
    {/if}
  </div>
</section>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 24px 0;
  }
  .hero-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .stamp {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }

  .number {
    display: flex;
    align-items: baseline;
    color: var(--paper);
    font-family: var(--font-display);
  }
  .int {
    font-variation-settings: 'opsz' 144, 'wght' 240, 'SOFT' 100;
    font-size: clamp(8rem, 32vw, 16rem);
    line-height: 0.82;
    letter-spacing: -0.045em;
  }
  .dec {
    font-variation-settings: 'opsz' 96, 'wght' 280, 'SOFT' 80;
    font-size: clamp(3.4rem, 14vw, 6.8rem);
    line-height: 0.82;
    letter-spacing: -0.02em;
    color: var(--paper-soft);
  }
  .unit {
    font-variation-settings: 'opsz' 60, 'wght' 350, 'SOFT' 60;
    font-size: clamp(1.8rem, 7vw, 3.5rem);
    color: var(--paper-mute);
    align-self: flex-start;
    margin-left: 8px;
    margin-top: 0.4em;
  }

  .target {
    display: flex;
    align-items: baseline;
    gap: 10px;
    color: var(--paper-soft);
  }
  .target-label {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 50;
    font-style: italic;
    font-size: 0.95rem;
  }
  .target-num {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 24, 'wght' 500, 'SOFT' 50;
    font-size: 1.05rem;
    color: var(--paper);
  }
  .delta {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--copper);
    margin-left: 4px;
  }
</style>
