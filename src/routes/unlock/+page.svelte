<script lang="ts">
  let password = $state('');
  let err = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    err = '';
    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        window.location.href = '/';
      } else {
        err = r.status === 401 ? 'Wrong password' : 'Could not unlock';
      }
    } catch {
      err = 'Network error';
    } finally {
      busy = false;
    }
  }
</script>

<main class="unlock">
  <form onsubmit={submit}>
    <h1>Locked</h1>
    <input
      type="password"
      bind:value={password}
      placeholder="Password"
      autocomplete="current-password"
      aria-label="Password"
    />
    {#if err}<p class="err">{err}</p>{/if}
    <button type="submit" disabled={busy || !password}>{busy ? 'Unlocking…' : 'Unlock'}</button>
  </form>
</main>

<style>
  .unlock {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 22px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 320px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }
  input,
  button {
    padding: 12px 14px;
    border-radius: var(--radius, 10px);
    border: 1px solid var(--border, #3334);
    font: inherit;
  }
  button {
    cursor: pointer;
  }
  .err {
    color: var(--danger, #d33);
    margin: 0;
    font-size: 0.9rem;
  }
</style>
