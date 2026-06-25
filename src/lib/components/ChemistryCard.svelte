<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { spa }: { spa: SpaState | null } = $props();

  type ChemState = 'ok' | 'low' | 'high' | 'unknown';

  function chemState(v: number | undefined, lo: number, hi: number): ChemState {
    if (v == null) return 'unknown';
    if (v < lo) return 'low';
    if (v > hi) return 'high';
    return 'ok';
  }

  function stateWord(s: ChemState) {
    return { ok: 'in range', low: 'below', high: 'above', unknown: '—' }[s];
  }
  // Collapse the spa's 5-level sanitizer band (SpaboyColor 0–4) to the 3-level
  // state the ORP block renders.
  function bandToChemState(b: number | undefined): ChemState {
    if (b == null) return 'unknown';
    if (b === 2) return 'ok';
    return b < 2 ? 'low' : 'high';
  }
  function stateColor(s: ChemState) {
    return s === 'ok' ? 'var(--moss)' : s === 'unknown' ? 'var(--paper-mute)' : 'var(--amber)';
  }
  function fmt(n: number | null | undefined, d = 1): string {
    if (n == null) return '—';
    return n.toFixed(d).replace('.', ',');
  }

  let c = $derived(spa?.chemistry);
  let phVal = $derived(c?.ph);
  let orpVal = $derived(c?.orp);
  let clBand = $derived(c?.clBand);
  let phState = $derived(chemState(phVal, 7.2, 7.8));
  // Arctic's Spa Boy maintains ORP in a 545–550 mV band (LOW preset; the spa
  // also offers MID 645–655 / HIGH 745–755). Prefer the spa's own verdict
  // (orpColor) so the ORP and CL blocks never disagree; fall back to the band
  // numbers only when orpColor is absent.
  let orpState = $derived(clBand != null ? bandToChemState(clBand) : chemState(orpVal, 545, 550));

  // CL is the Spa Boy's own sanitizer band (SpaboyColor: 0 very low … 4 very
  // high), inferred from ORP — there's no chlorine probe, so we show a band
  // rather than a number, mirroring the Arctic app.
  const CL_WORDS = ['Very low', 'Low', 'OK', 'High', 'Very high'];
  function clWord(b: number | undefined): string {
    return b == null ? '—' : (CL_WORDS[b] ?? '—');
  }
  function clColor(b: number | undefined): string {
    if (b == null) return 'var(--paper-mute)';
    if (b === 2) return 'var(--moss)';
    if (b === 1 || b === 3) return 'var(--amber)';
    return 'var(--rust)';
  }
  function clSeverity(b: number | undefined): string {
    if (b == null) return '—';
    if (b === 2) return 'in range';
    if (b === 1 || b === 3) return 'borderline';
    return 'out of range';
  }

  let openTip: 'ph' | 'orp' | 'cl' | null = $state(null);

  function toggleTip(which: 'ph' | 'orp' | 'cl', e: Event) {
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

<section class="card anim-rise" style="animation-delay: 240ms;">
  <div class="head">
    <span class="head-label">Water chemistry</span>
    <span class="src">Spa Boy</span>
  </div>

  <div class="grid">
    <div class="block">
      <div class="block-label">
        <span>pH</span>
        <button
          type="button"
          class="info"
          aria-label="What is pH?"
          aria-expanded={openTip === 'ph'}
          onclick={(e) => toggleTip('ph', e)}
        >i</button>
      </div>
      <div class="block-value" style="color: {stateColor(phState)};">{fmt(phVal, 1)}</div>
      <div class="block-state" style="color: {stateColor(phState)};">
        <span class="state-dot" style="background: {stateColor(phState)};"></span>
        {stateWord(phState)}
      </div>
      <div class="block-range">7,2 — 7,8</div>
    </div>

    <div class="block">
      <div class="block-label">
        <span>ORP</span>
        <button
          type="button"
          class="info"
          aria-label="What is ORP?"
          aria-expanded={openTip === 'orp'}
          onclick={(e) => toggleTip('orp', e)}
        >i</button>
      </div>
      <div class="block-value" style="color: {stateColor(orpState)};">
        {orpVal ?? '—'}<span class="unit">mV</span>
      </div>
      <div class="block-state" style="color: {stateColor(orpState)};">
        <span class="state-dot" style="background: {stateColor(orpState)};"></span>
        {stateWord(orpState)}
      </div>
      <div class="block-range">545 — 550</div>
    </div>

    <div class="block">
      <div class="block-label">
        <span>CL</span>
        <button
          type="button"
          class="info"
          aria-label="What is CL?"
          aria-expanded={openTip === 'cl'}
          onclick={(e) => toggleTip('cl', e)}
        >i</button>
      </div>
      <div class="block-value band" style="color: {clColor(clBand)};">{clWord(clBand)}</div>
      <div class="block-state" style="color: {clColor(clBand)};">
        <span class="state-dot" style="background: {clColor(clBand)};"></span>
        {clSeverity(clBand)}
      </div>
      <div class="block-range">from ORP</div>
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

      {#if phVal != null && phVal > 7.8}
        <div class="tip-heading">If high (yours: {phVal.toFixed(2)})</div>
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
      {:else if phVal != null && phVal < 7.2}
        <div class="tip-heading">If low (yours: {phVal.toFixed(2)})</div>
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
      <div class="tip-range">target 545 — 550 mV</div>
      <p>
        Oxidation-Reduction Potential, in millivolts. It's an indirect measure of how strongly the
        water can sanitize — higher means more capacity to kill bacteria and break down organics.
        Below the ~545 mV target band, the sanitizer isn't pulling its weight.
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

  {#if openTip === 'cl'}
    <div class="chem-tooltip" role="tooltip">
      <h3>CL — chlorine / sanitizer band</h3>
      <div class="tip-range">very low · low · ok · high · very high</div>
      <p>
        The Spa Boy has no direct chlorine probe — it rates sanitizer as a band, inferred from the
        ORP reading. So CL tracks ORP: when ORP sits in its target window, CL reads OK.
      </p>

      {#if clBand != null && clBand < 2}
        <div class="tip-heading">If low</div>
        <ol>
          <li>
            <div>
              <b>Drop pH toward 7.4</b>
              <span>Sanitizer effectiveness falls sharply above pH 7.6 — usually the dominant cause. Fix here first.</span>
            </div>
          </li>
          <li>
            <div>
              <b>Check salt, then boost</b>
              <span>Spa Boy needs ~1500–2000 ppm salt to produce sanitizer. If salt is fine, run a boost cycle (or MPS shock if you're hosting tonight).</span>
            </div>
          </li>
        </ol>
      {:else if clBand != null && clBand > 2}
        <div class="tip-heading">If high</div>
        <ol>
          <li>
            <div>
              <b>Stop any boost / over-production</b>
              <span>Cancel boost mode and let production settle back to the normal band over a cycle or two.</span>
            </div>
          </li>
          <li>
            <div>
              <b>Wait before soaking</b>
              <span>Strongly over-sanitized water can irritate skin and eyes. Let it come down before heavy use.</span>
            </div>
          </li>
        </ol>
      {:else}
        <div class="tip-heading">In range</div>
        <p style="margin-bottom:0; color:var(--paper-soft);">
          Sanitizer sitting in the healthy band. Nothing to do — recheck after heavy bather use.
        </p>
      {/if}

      <div class="tip-footer">
        Always trust your physical test kit + Arctic's published thresholds over generic advice.
      </div>
    </div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 18px;
  }
  .head-label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }
  .src {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 60;
    font-size: 0.85rem;
    color: var(--paper-soft);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .block-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
    margin-bottom: 6px;
  }
  .info {
    background: transparent;
    border: 1px solid var(--paper-faint);
    color: var(--paper-mute);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: all 0.3s;
  }
  .info:hover,
  .info[aria-expanded='true'] {
    color: var(--paper);
    border-color: var(--copper-dim);
  }
  .block-value {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 96, 'wght' 280, 'SOFT' 60;
    font-size: 2.5rem;
    line-height: 1;
    color: var(--paper);
    letter-spacing: -0.02em;
    display: flex;
    align-items: baseline;
  }
  .unit {
    font-variation-settings: 'opsz' 40, 'wght' 350, 'SOFT' 50;
    font-size: 0.9rem;
    color: var(--paper-mute);
    margin-left: 6px;
  }
  /* CL shows a word ("Very high"), not a number — smaller so it fits the
     narrower three-up column and can wrap to two lines if needed. */
  .block-value.band {
    font-size: 1.45rem;
    font-variation-settings: 'opsz' 40, 'wght' 340, 'SOFT' 60;
    line-height: 1.08;
    align-items: flex-start;
  }
  .block-state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 60;
    font-size: 0.85rem;
  }
  .state-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }
  .block-range {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.14em;
    color: var(--paper-faint);
    margin-top: 6px;
  }

  .chem-tooltip {
    position: relative;
    z-index: 2;
    margin-top: 22px;
    padding: 20px 22px 22px;
    border: 1px solid var(--paper-line);
    border-radius: var(--r-md);
    background: linear-gradient(180deg, rgba(36, 58, 88, 0.55), rgba(18, 32, 53, 0.85));
    animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .chem-tooltip h3 {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 24, 'SOFT' 60, 'wght' 500;
    font-size: 1.1rem;
    color: var(--paper);
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .chem-tooltip .tip-range {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--paper-faint);
    margin-bottom: 14px;
  }
  .chem-tooltip p {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 14, 'wght' 400;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--paper-soft);
    margin: 0 0 16px;
  }
  .chem-tooltip .tip-heading {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--copper);
    margin: 0 0 10px;
  }
  .chem-tooltip ol {
    list-style: none;
    padding: 0;
    margin: 0;
    counter-reset: tip;
  }
  .chem-tooltip ol li {
    counter-increment: tip;
    display: grid;
    grid-template-columns: 28px 1fr;
    align-items: baseline;
    gap: 8px;
    padding: 8px 0;
    border-top: 1px solid var(--paper-line);
  }
  .chem-tooltip ol li:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .chem-tooltip ol li::before {
    content: counter(tip, decimal-leading-zero);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--copper);
    letter-spacing: 0.12em;
  }
  .chem-tooltip ol li b {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 14, 'wght' 500;
    font-size: 0.92rem;
    color: var(--paper);
    font-weight: normal;
  }
  .chem-tooltip ol li span {
    display: block;
    font-family: var(--font-display);
    font-size: 0.86rem;
    line-height: 1.45;
    color: var(--paper-soft);
    margin-top: 2px;
  }
  .chem-tooltip .tip-footer {
    margin-top: 16px;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--paper-faint);
    letter-spacing: 0.06em;
    line-height: 1.5;
  }
</style>
