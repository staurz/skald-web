<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { spaState, startStateStream } from '$lib/client/state-store';
  import { fToC } from '$lib/util/units';
  import TemperatureCard from '$lib/components/TemperatureCard.svelte';
  import AccessoryGrid from '$lib/components/AccessoryGrid.svelte';
  import ChemistryCard from '$lib/components/ChemistryCard.svelte';

  onMount(startStateStream);

  let bootedAt = Date.now();
  function uptimeStamp(): string {
    const ms = Date.now() - bootedAt;
    const mins = Math.floor(ms / 60000);
    return mins < 1 ? 'just started' : `running ${mins} min`;
  }
</script>

<main class="app">
  <header class="topbar">
    <a class="mark" href="/">
      Skålda<span class="mark-dot"></span>
    </a>
    <nav class="nav">
      <a href="/" class:active={$page.url.pathname === '/'}>Now</a>
      <a href="/history" class:active={$page.url.pathname === '/history'}>History</a>
      <a href="/alerts" class:active={$page.url.pathname === '/alerts'}>Alerts</a>
    </nav>
  </header>

  <div class="dash-grid">
    <div class="col-main">
      <TemperatureCard state={$spaState} />
      <AccessoryGrid state={$spaState} />
    </div>
    <div class="col-side">
      <ChemistryCard state={$spaState} />
    </div>
  </div>

  <div class="footer-stamp">
    {uptimeStamp()}
    {#if $spaState?.temperatureF != null}
      · {fToC($spaState.temperatureF)} °C
    {/if}
  </div>
</main>
