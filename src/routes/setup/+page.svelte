<script lang="ts">
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let result = $state<{ ok: boolean; spaUuid?: string; expires_in?: number; error?: string } | null>(null);

  async function submit() {
    busy = true; result = null;
    try {
      const res = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      result = await res.json();
      if (!res.ok) result = { ok: false, error: (result as any)?.message ?? 'unknown error' };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    } finally {
      busy = false;
      password = '';
    }
  }
</script>

<div class="max-w-md mx-auto mt-12 p-6">
  <h1 class="text-2xl font-bold mb-4">First-time setup</h1>
  <p class="text-sm text-gray-500 mb-6">Enter your Arctic Spa credentials. Your raw password is used once to fetch a long-lived token, then discarded — only the hash and refresh token are stored.</p>
  <form onsubmit={(e) => { e.preventDefault(); submit(); }} class="space-y-3">
    <input type="email" placeholder="email" bind:value={email} required class="w-full border p-2" />
    <input type="password" placeholder="password" bind:value={password} required class="w-full border p-2" />
    <button disabled={busy} class="w-full bg-black text-white p-2 disabled:opacity-50">{busy ? 'Connecting…' : 'Connect'}</button>
  </form>
  {#if result}
    <pre class="mt-4 text-xs">{JSON.stringify(result, null, 2)}</pre>
  {/if}
</div>
