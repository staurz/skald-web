<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
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
    savedMsg = res.ok ? 'saved' : 'save failed';
    setTimeout(() => (savedMsg = ''), 2400);
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
      /* user is mid-typing invalid JSON — ignore */
    }
  }

  function kindLabel(kind: AlertRule['kind']): string {
    switch (kind) {
      case 'error_present': return 'Error present';
      case 'temperature_outside': return 'Temperature outside range';
      case 'filter_cycle_missed': return 'Filter cycle missed';
      case 'chemistry_outside': return 'Chemistry outside range';
    }
  }

  onMount(load);
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

  <section class="hero" style="margin-bottom:48px;">
    <div class="hero-label">
      Alerts
      <span class="timestamp">{rules.length} rule{rules.length === 1 ? '' : 's'}</span>
    </div>
    <div class="hero-meta" style="margin-top:8px;">
      <button class="btn-primary" onclick={enablePush}>Enable push</button>
      {#if pushReady}
        <span class="hero-status">Subscribed</span>
      {/if}
    </div>
  </section>

  {#if rules.length === 0}
    <section class="card">
      <div class="card-label">
        No rules yet
        <span class="stamp">tap + to add</span>
      </div>
      <p style="font-family:var(--display); color:var(--paper-soft); font-size:0.95rem; line-height:1.5; position:relative; z-index:1;">
        Rules watch the live spa state and fire a push notification when they
        match. Set a temperature window, a chemistry range, or a watch on the
        spa's own error codes — and we'll let you know.
      </p>
    </section>
  {/if}

  <ul style="list-style:none; padding:0; margin:0; position:relative; z-index:1;">
    {#each rules as rule, i (rule.id)}
      <li class="card" style="margin-top:18px;">
        <div class="card-label">
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
            <input type="checkbox" bind:checked={rule.enabled} style="accent-color: var(--copper);" />
            <span style="text-transform:none; letter-spacing:0.04em; color:var(--paper);">
              {kindLabel(rule.kind)}
            </span>
          </label>
          <span class="stamp">{rule.id}</span>
        </div>

        <div style="display:grid; grid-template-columns:1fr auto; gap:14px; position:relative; z-index:1;">
          <select
            bind:value={rule.kind}
            class="input-mono"
            style="text-transform:uppercase; letter-spacing:0.14em; font-size:0.66rem;"
          >
            <option value="error_present">Error present</option>
            <option value="temperature_outside">Temperature outside</option>
            <option value="filter_cycle_missed">Filter cycle missed</option>
            <option value="chemistry_outside">Chemistry outside</option>
          </select>
          <button
            type="button"
            class="btn-ghost"
            onclick={() => removeRule(i)}
            style="font-size:0.6rem;"
          >
            Remove
          </button>
        </div>

        <div style="margin-top:14px; position:relative; z-index:1;">
          <div class="hero-target-label" style="margin-bottom:8px;">Threshold (JSON)</div>
          <textarea
            rows="2"
            value={thresholdText(rule)}
            oninput={(e) => setThreshold(i, e.currentTarget.value)}
            class="input-mono"
            placeholder={'{"minF":100,"maxF":105}'}
          ></textarea>
        </div>
      </li>
    {/each}
  </ul>

  <div style="display:flex; gap:14px; align-items:center; justify-content:center; margin-top:32px;">
    <button onclick={newRule} class="btn-ghost">+ Add rule</button>
    <button onclick={save} disabled={saving} class="btn-primary">
      {saving ? 'Saving…' : 'Save'}
    </button>
    {#if savedMsg}
      <span class="hero-target-label">{savedMsg}</span>
    {/if}
  </div>

  <div class="footer-stamp">push notifications via web push</div>
</main>
