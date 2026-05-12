<script lang="ts">
  import { onMount } from 'svelte';
  import { spaState, startStateStream } from '$lib/client/state-store';
  import TemperatureCard from '$lib/components/TemperatureCard.svelte';
  import AccessoryGrid from '$lib/components/AccessoryGrid.svelte';
  import ChemistryCard from '$lib/components/ChemistryCard.svelte';

  onMount(startStateStream);
</script>

<main class="max-w-3xl mx-auto p-4 space-y-4">
  <header class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">My Spa</h1>
    <nav class="flex gap-3 text-sm">
      <a href="/history" class="hover:underline">History</a>
      <a href="/alerts" class="hover:underline">Alerts</a>
    </nav>
  </header>
  <TemperatureCard state={$spaState} />
  <AccessoryGrid state={$spaState} />
  <ChemistryCard state={$spaState} />
</main>
