<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { spaState } from '$lib/client/state-store';

  let { children } = $props();

  // Heating across the whole atmosphere — when the heaters are on, the body
  // gets `.is-heating` and the radial gradients warm up a notch.
  onMount(() => {
    return spaState.subscribe((s) => {
      if (typeof document === 'undefined') return;
      document.body.classList.toggle('is-heating', s?.heating === true);
    });
  });
</script>

{@render children()}
