<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let {
    state,
    onToggle,
  }: {
    state: SpaState | null;
    onToggle?: (id: string) => void;
  } = $props();

  type Item = { id: string; label: string; on: boolean };

  let items = $derived<Item[]>([
    ...(state?.pumps ?? []).map((p) => ({
      id: `pump-${p.id}`,
      label: `Pump ${p.id}`,
      on: p.speed > 0,
    })),
    { id: 'blower', label: 'Blower', on: !!state?.blower },
    { id: 'lights', label: 'Lights', on: !!state?.lights },
  ]);
</script>

<section class="card anim-rise" style="animation-delay: 240ms;">
  <div class="head">
    <span class="head-label">Accessories</span>
    <span class="count">{items.filter((a) => a.on).length} / {items.length} on</span>
  </div>

  <div class="grid">
    {#each items as a (a.id)}
      {#if onToggle}
        <button
          class="tile"
          class:on={a.on}
          type="button"
          aria-pressed={a.on}
          onclick={() => onToggle?.(a.id)}
        >
          <span class="tile-label">{a.label}</span>
          <span class="tile-state">
            {a.on ? 'on' : 'off'}
            {#if a.on}<span class="tile-dot" aria-hidden="true"></span>{/if}
          </span>
        </button>
      {:else}
        <div class="tile readonly" class:on={a.on}>
          <span class="tile-label">{a.label}</span>
          <span class="tile-state">
            {a.on ? 'on' : 'off'}
            {#if a.on}<span class="tile-dot" aria-hidden="true"></span>{/if}
          </span>
        </div>
      {/if}
    {/each}
  </div>
</section>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .head-label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
  }
  .count {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 50;
    font-size: 0.85rem;
    color: var(--paper-soft);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .tile {
    position: relative;
    text-align: left;
    cursor: pointer;
    padding: 16px 16px;
    border-radius: var(--r-md);
    background: rgba(243, 237, 224, 0.04);
    border: 1px solid rgba(243, 237, 224, 0.06);
    color: var(--paper);
    transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    font: inherit;
  }
  .tile.readonly {
    cursor: default;
  }
  .tile:hover {
    border-color: rgba(243, 237, 224, 0.12);
  }
  .tile.readonly:hover {
    border-color: rgba(243, 237, 224, 0.06);
  }
  .tile.on {
    background: radial-gradient(
      120% 80% at 50% 120%,
      var(--copper-aura),
      rgba(26, 43, 68, 0.4) 80%
    );
    border-color: var(--copper-dim);
    box-shadow:
      0 8px 26px var(--copper-aura),
      inset 0 1px 0 rgba(243, 237, 224, 0.06);
  }
  .tile-label {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--paper-mute);
    margin-bottom: 10px;
  }
  .tile.on .tile-label {
    color: var(--copper);
  }
  .tile-state {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 36, 'wght' 300, 'SOFT' 50;
    font-size: 1.6rem;
    color: var(--paper);
  }
  .tile.on .tile-state {
    font-variation-settings: 'opsz' 36, 'wght' 400, 'SOFT' 70;
  }
  .tile-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--copper);
    box-shadow: 0 0 8px var(--copper);
    margin-left: 4px;
  }
</style>
