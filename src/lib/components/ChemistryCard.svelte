<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { spa }: { spa: SpaState | null } = $props();
  let c = $derived(spa?.chemistry);
  let ts = $derived(spa?.ts);
  let openTip: 'ph' | 'orp' | null = $state(null);

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

  function toggleTip(which: 'ph' | 'orp', e: Event) {
    e.stopPropagation();
    openTip = openTip === which ? null : which;
  }

  function maybeDismiss(e: MouseEvent) {
    if (openTip == null) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.chem-tooltip')) return;
    openTip = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') openTip = null;
  }
</script>

<svelte:window onclick={maybeDismiss} onkeydown={onKey} />

<section class="card">
  <div class="card-label">
    Water chemistry
    {#if stamp}<span class="stamp">{stamp}</span>{/if}
  </div>
  <div class="chem-grid">
    <div class="chem">
      <div class="chem-name">
        pH
        <button
          type="button"
          class="chem-info"
          aria-label="What is pH?"
          aria-expanded={openTip === 'ph'}
          onclick={(e) => toggleTip('ph', e)}
        >
          i
        </button>
      </div>
      <div class={`chem-value ${phTone}`}>{c?.ph?.toFixed(2) ?? '—'}</div>
      <div class="chem-range">7.2 — 7.8</div>
    </div>
    <div class="chem">
      <div class="chem-name">
        ORP
        <button
          type="button"
          class="chem-info"
          aria-label="What is ORP?"
          aria-expanded={openTip === 'orp'}
          onclick={(e) => toggleTip('orp', e)}
        >
          i
        </button>
      </div>
      <div class={`chem-value ${orpTone}`}>{c?.orp ?? '—'}<span class="chem-unit">mV</span></div>
      <div class="chem-range">600 — 800</div>
    </div>
  </div>

  {#if openTip === 'ph'}
    <div class="chem-tooltip" role="tooltip">
      <h3>pH — acidity of the water</h3>
      <div class="tip-range">target 7.2 — 7.8</div>
      <p>
        pH is the balance between acidic and alkaline. The water itself isn't dangerous outside the
        target band, but the wrong pH makes the sanitizer (ORP) weaker and slowly corrodes
        equipment.
      </p>

      {#if c?.ph != null && c.ph > 7.8}
        <div class="tip-heading">If high (yours: {c.ph.toFixed(2)})</div>
        <ol>
          <li>
            <div>
              <b>Add pH decreaser</b>
              <span>Sodium bisulfate — dose per the bottle for your spa volume. Pour with the pumps on and recheck after a circulation cycle.</span>
            </div>
          </li>
          <li>
            <div>
              <b>This is also why ORP is low</b>
              <span>Sanitizer effectiveness drops sharply above 7.6. Bringing pH back into the target band will raise effective ORP without changing anything else.</span>
            </div>
          </li>
        </ol>
      {:else if c?.ph != null && c.ph < 7.2}
        <div class="tip-heading">If low (yours: {c.ph.toFixed(2)})</div>
        <ol>
          <li>
            <div>
              <b>Add pH increaser</b>
              <span>Sodium carbonate (soda ash). Dose per the bottle and recheck after circulation.</span>
            </div>
          </li>
          <li>
            <div>
              <b>Low pH corrodes equipment</b>
              <span>Heater elements and metal fittings degrade faster in acidic water.</span>
            </div>
          </li>
        </ol>
      {:else}
        <div class="tip-heading">In range</div>
        <p style="margin-bottom:0; color:var(--paper-soft);">
          Currently sitting in the target band. Recheck weekly and after heavy bather use.
        </p>
      {/if}

      <div class="tip-footer">
        Always trust your physical test kit + Arctic's published thresholds over generic advice.
      </div>
    </div>
  {/if}

  {#if openTip === 'orp'}
    <div class="chem-tooltip" role="tooltip">
      <h3>ORP — the water's sanitizing power</h3>
      <div class="tip-range">target 600 — 800 mV</div>
      <p>
        Oxidation-Reduction Potential, in millivolts. It's an indirect measure of how strongly the
        water can sanitize — higher means more capacity to kill bacteria and break down organics.
        Below 600 mV, the sanitizer isn't pulling its weight.
      </p>

      <div class="tip-heading">If low, in order</div>
      <ol>
        <li>
          <div>
            <b>Drop pH toward 7.4</b>
            <span>Sanitizer effectiveness falls sharply above pH 7.6. This is usually the dominant cause of low ORP — fix here first before adding anything else.</span>
          </div>
        </li>
        <li>
          <div>
            <b>Check salt level</b>
            <span>Spa Boy electrolyzes dissolved salt to produce sanitizer. Target around 1500–2000 ppm — read it off the top-side panel. Below ~1200 ppm, output drops noticeably.</span>
          </div>
        </li>
        <li>
          <div>
            <b>Check electrode wear</b>
            <span>The electrode degrades over time and produces less sanitizer as it does. Worth budgeting for a replacement when wear climbs past 80%. Arctic sells them.</span>
          </div>
        </li>
        <li>
          <div>
            <b>If urgent: boost or shock</b>
            <span>The Spa Boy has a "boost" mode that ramps production for a day. MPS shock works for an immediate spike if you're hosting tonight.</span>
          </div>
        </li>
      </ol>

      <div class="tip-footer">
        Always trust your physical test kit + Arctic's published thresholds over generic advice.
      </div>
    </div>
  {/if}
</section>
