<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';

  let { children } = $props();
  let dark = $state(false);

  onMount(() => {
    const stored = localStorage.getItem('theme');
    dark = stored === 'dark' || (stored == null && matchMedia('(prefers-color-scheme: dark)').matches);
    apply();
  });

  function toggle() {
    dark = !dark;
    apply();
  }

  function apply() {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }
</script>

<div class="min-h-screen bg-gray-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors">
  {@render children()}
  <button
    class="fixed bottom-4 right-4 rounded-full w-12 h-12 flex items-center justify-center text-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-lg hover:scale-105 transition-transform"
    onclick={toggle}
    aria-label="Toggle dark mode"
  >
    {dark ? '☀' : '☾'}
  </button>
</div>
