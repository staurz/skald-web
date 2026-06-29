<script lang="ts">
  import { spaState } from '$lib/client/state-store';
  import TemperatureCard from '$lib/components/TemperatureCard.svelte';
  import AccessoryGrid from '$lib/components/AccessoryGrid.svelte';
  import ChemistryCard from '$lib/components/ChemistryCard.svelte';
</script>

<svelte:head>
  <title>Skålda — Now</title>
</svelte:head>

<div class="now">
  <TemperatureCard state={$spaState} />

  <div class="grid">
    <ChemistryCard spa={$spaState} />
    <AccessoryGrid state={$spaState} />
  </div>
</div>

<style>
  .now {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 18px;
    /* Size each card to its own content; otherwise the shorter chemistry card
       stretches to match the taller accessory grid and gains dead space. */
    align-items: start;
  }
  @media (min-width: 768px) {
    /* Desktop: gather the hero + cards into one contained, centred column
       (chemistry stacked over accessories) instead of stranding a small
       cluster at the top of a tall, mostly-empty page. */
    .now {
      max-width: 460px;
      width: 100%;
      margin-inline: auto;
      min-height: calc(100vh - 230px);
      justify-content: center;
    }
    /* .grid stays a single column, so the cards stack vertically. */
    .grid {
      gap: 22px;
    }
  }
</style>
