<script lang="ts">
  import { onMount } from 'svelte';
  import type { AlertRule } from '$lib/server/types';

  let rules = $state<AlertRule[]>([]);
  let publicKey = $state<string | null>(null);
  let pushReady = $state(false);
  let saving = $state(false);
  let savedMsg = $state('');

  async function load() {
    const [r, p] = await Promise.all([
      fetch('/api/alerts/rules').then((res) => res.json()),
      fetch('/api/alerts/subscribe').then((res) => res.json()),
    ]);
    rules = r.rules;
    publicKey = p.publicKey;
  }

  function newRule() {
    rules = [
      ...rules,
      {
        id: `r-${Date.now()}`,
        kind: 'error_present',
        threshold: {},
        enabled: true,
      },
    ];
  }

  function removeRule(i: number) {
    rules = rules.filter((_, idx) => idx !== i);
  }

  async function save() {
    saving = true;
    savedMsg = '';
    const res = await fetch('/api/alerts/rules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules }),
    });
    saving = false;
    savedMsg = res.ok ? 'Saved.' : 'Save failed.';
    setTimeout(() => (savedMsg = ''), 2000);
  }

  function urlBase64ToUint8Array(base64: string) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function enablePush() {
    if (!publicKey) return;
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch('/api/alerts/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    pushReady = true;
  }

  function thresholdText(r: AlertRule): string {
    return JSON.stringify(r.threshold);
  }
  function setThreshold(i: number, value: string) {
    try {
      const parsed = JSON.parse(value || '{}');
      rules[i] = { ...rules[i], threshold: parsed };
    } catch {
      /* ignore — user is mid-typing invalid JSON */
    }
  }

  onMount(load);
</script>

<main class="max-w-3xl mx-auto p-4 space-y-4">
  <header class="flex items-center justify-between mb-2">
    <h1 class="text-xl font-bold">Alerts</h1>
    <a href="/" class="text-sm hover:underline">← Dashboard</a>
  </header>

  <div class="flex items-center gap-3">
    <button
      onclick={enablePush}
      class="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-3 py-1 rounded"
    >
      Enable push notifications
    </button>
    {#if pushReady}
      <span class="text-emerald-600 text-sm">subscribed</span>
    {/if}
  </div>

  <ul class="space-y-3">
    {#each rules as rule, i (rule.id)}
      <li class="rounded-xl border border-gray-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-900 space-y-2">
        <div class="flex items-center gap-2">
          <input type="checkbox" bind:checked={rule.enabled} class="w-4 h-4" />
          <select bind:value={rule.kind} class="bg-transparent border border-gray-300 dark:border-zinc-700 rounded px-2 py-1 text-sm">
            <option value="error_present">Error present</option>
            <option value="temperature_outside">Temperature outside</option>
            <option value="filter_cycle_missed">Filter cycle missed</option>
            <option value="chemistry_outside">Chemistry outside</option>
          </select>
          <span class="ml-auto text-xs text-gray-500">{rule.id}</span>
          <button onclick={() => removeRule(i)} class="text-xs text-red-500 hover:underline">remove</button>
        </div>
        <textarea
          rows="2"
          value={thresholdText(rule)}
          oninput={(e) => setThreshold(i, e.currentTarget.value)}
          class="w-full text-xs font-mono border border-gray-300 dark:border-zinc-700 bg-transparent rounded p-2"
          placeholder={'{"minF":100,"maxF":105}'}
        ></textarea>
      </li>
    {/each}
  </ul>

  <div class="flex items-center gap-3">
    <button onclick={newRule} class="bg-gray-200 dark:bg-zinc-800 px-3 py-1 rounded text-sm">+ Add rule</button>
    <button
      onclick={save}
      disabled={saving}
      class="bg-emerald-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
    >
      Save
    </button>
    {#if savedMsg}<span class="text-sm text-gray-500">{savedMsg}</span>{/if}
  </div>
</main>
