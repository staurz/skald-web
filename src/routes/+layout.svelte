<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { spaState, startStateStream } from '$lib/client/state-store';
  import TabBar from '$lib/components/TabBar.svelte';
  import '../app.css';

  let { children } = $props();

  onMount(startStateStream);

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('is-heating', !!$spaState?.heating);
  });

  // Slide between primary tabs based on order. Same-tab sub-routes
  // (e.g., /alerts ↔ /alerts/rules) don't animate.
  const tabOrder = ['/', '/history', '/alerts'];
  const SLIDE_MS = 240;
  const SLIDE_PX = 80;

  function tabSeg(path: string): string {
    return '/' + (path.split('/')[1] || '');
  }

  let prevSeg = $state('');

  // direction is $derived so it's evaluated synchronously when the
  // transition is set up — $effect.pre was running too late, leaving
  // direction at 0 (no animation) on the first nav.
  let direction = $derived.by(() => {
    const s = tabSeg($page.url.pathname);
    if (!prevSeg || s === prevSeg) return 0;
    const pi = tabOrder.indexOf(prevSeg);
    const ci = tabOrder.indexOf(s);
    if (pi < 0 || ci < 0) return 0;
    return ci > pi ? 1 : -1;
  });

  // Update prevSeg AFTER the transition has been set up (post-DOM).
  $effect(() => {
    const s = tabSeg($page.url.pathname);
    if (s !== prevSeg) prevSeg = s;
  });

  let transitionKey = $derived(tabSeg($page.url.pathname));
  let activeDuration = $derived(direction === 0 ? 0 : SLIDE_MS);
</script>

<header class="topbar anim-rise">
  <a class="mark" href="/" aria-label="Skålda — home">
    <span class="mark-text">Skålda</span>
    <span class="mark-dot"></span>
  </a>
</header>

<div class="transition-wrap">
  {#key transitionKey}
    <main
      class="app"
      in:fly={{ x: SLIDE_PX * direction, duration: activeDuration, easing: cubicOut }}
      out:fly={{ x: -SLIDE_PX * direction, duration: activeDuration, easing: cubicOut }}
    >
      {@render children()}
    </main>
  {/key}
</div>

<TabBar />

<style>
  /* During a transition both leaving + entering <main> are mounted —
     grid-stack them in the same cell so the slide animation overlaps
     rather than the new page pushing the old one below. */
  .transition-wrap {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    overflow-x: clip;
  }
  .transition-wrap > main {
    grid-column: 1;
    grid-row: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .transition-wrap > main {
      animation: none !important;
      transform: none !important;
    }
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(20px + env(safe-area-inset-top)) 22px 16px;
    background: linear-gradient(to bottom, rgba(10, 19, 32, 0.85), rgba(10, 19, 32, 0));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .mark {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    color: var(--paper);
    text-decoration: none;
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 24, 'wght' 500, 'SOFT' 70;
    font-size: 1.4rem;
    letter-spacing: -0.01em;
  }
  .mark-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--copper);
    box-shadow: 0 0 10px var(--copper-dim);
    align-self: center;
    margin-bottom: 4px;
  }

  .app {
    max-width: 640px;
    margin: 0 auto;
    padding: 8px 22px calc(100px + env(safe-area-inset-bottom));
  }
  @media (min-width: 768px) {
    .app {
      max-width: 1120px;
      padding: 24px 32px calc(100px + env(safe-area-inset-bottom));
    }
  }
</style>
