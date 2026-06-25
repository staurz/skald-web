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
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: 1fr 1fr;
      gap: 22px;
    }
  }
</style>
