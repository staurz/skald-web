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
    font-family: var(--display);
    font-variation-settings: 'opsz' 36, 'SOFT' 60, 'wght' 420;
    font-size: 1.4rem;
    color: var(--paper);
  }
  input {
    padding: 12px 14px;
    border-radius: var(--r-sm);
    border: 1px solid var(--paper-faint);
    background: rgba(243, 237, 224, 0.06);
    color: var(--paper);
    font: inherit;
  }
  input::placeholder {
    color: var(--paper-mute);
  }
  input:focus {
    outline: none;
    border-color: var(--copper);
  }
  button {
    padding: 12px 14px;
    border-radius: 999px;
    border: 0;
    background: var(--copper);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    color: var(--rust);
    margin: 0;
    font-size: 0.9rem;
  }
</style>
