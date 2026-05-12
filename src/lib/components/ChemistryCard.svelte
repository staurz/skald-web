<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { state }: { state: SpaState | null } = $props();
  let c = $derived(state?.chemistry);
  let ts = $derived(state?.ts);

  function tone(v: number | undefined, lo: number, hi: number): 'good' | 'warn' | 'bad' | 'empty' {
    if (v == null) return 'empty';
    if (v < lo - (hi - lo) * 0.15 || v > hi + (hi - lo) * 0.15) return 'bad';
    if (v < lo || v > hi) return 'warn';
    return 'good';
  }

  function relativeStamp(updatedAt?: number): string {
    if (!updatedAt) return '';
    const secs = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
    if (secs < 60) return `SpaBoy · ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `SpaBoy · ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `SpaBoy · ${hrs}h ago`;
  }

  let phTone = $derived(tone(c?.ph, 7.2, 7.8));
  let orpTone = $derived(tone(c?.orp, 600, 800));
  let stamp = $derived(relativeStamp(ts));
</script>

<section class="card">
  <div class="card-label">
    Water chemistry
    {#if stamp}<span class="stamp">{stamp}</span>{/if}
  </div>
  <div class="chem-grid">
    <div class="chem">
      <div class="chem-name">pH</div>
      <div class={`chem-value ${phTone}`}>{c?.ph?.toFixed(2) ?? '—'}</div>
      <div class="chem-range">7.2 — 7.8</div>
    </div>
    <div class="chem">
      <div class="chem-name">ORP</div>
      <div class={`chem-value ${orpTone}`}>{c?.orp ?? '—'}<span class="chem-unit">mV</span></div>
      <div class="chem-range">600 — 800</div>
    </div>
  </div>
</section>
