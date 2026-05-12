<script lang="ts">
  import type { SpaState } from '$lib/server/types';

  let { state }: { state: SpaState | null } = $props();
  let pumps = $derived(state?.pumps ?? []);
  let blower = $derived(state?.blower ?? false);
  let lights = $derived(state?.lights ?? false);

  let activeCount = $derived(
    pumps.filter((p) => p.speed > 0).length + (blower ? 1 : 0) + (lights ? 1 : 0),
  );
  let totalCount = $derived(pumps.length + 2);

  function speedLabel(speed: 0 | 1 | 2) {
    return speed === 0 ? 'Off' : speed === 1 ? 'Low' : 'High';
  }
</script>

<section class="card accessories">
  <div class="card-label">
    Accessories
    <span class="stamp">{activeCount} / {totalCount} on</span>
  </div>
  <div class="accessory-grid">
    {#each pumps as p (p.id)}
      <div class={`acc ${p.speed > 0 ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 6 v-2.5 M12 18 v2.5 M6 12 h-2.5 M18 12 h2.5" />
        </svg>
        <div class="acc-foot">
          <div class="acc-name">Pump {p.id}</div>
          <div class="acc-state">{speedLabel(p.speed)}</div>
        </div>
      </div>
    {/each}
    <div class={`acc ${blower ? 'on' : ''}`}>
      <svg viewBox="0 0 24 24">
        <path d="M4 14 Q8 8 12 14 T20 14" />
        <path d="M4 18 Q8 12 12 18 T20 18" />
      </svg>
      <div class="acc-foot">
        <div class="acc-name">Blower</div>
        <div class="acc-state">{blower ? 'On' : 'Off'}</div>
      </div>
    </div>
    <div class={`acc lights ${lights ? 'on' : ''}`}>
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 5 v-2 M12 21 v-2 M5 12 h-2 M21 12 h-2 M7 7 l-1.5 -1.5 M18.5 18.5 l-1.5 -1.5 M7 17 l-1.5 1.5 M18.5 5.5 l-1.5 1.5" />
      </svg>
      <div class="acc-foot">
        <div class="acc-name">Lights</div>
        <div class="acc-state">{lights ? 'On' : 'Off'}</div>
      </div>
    </div>
  </div>
</section>
