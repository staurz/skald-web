<script lang="ts">
  import { page } from '$app/stores';

  const tabs = [
    { path: '/',        label: 'Now',     icon: 'now' },
    { path: '/history', label: 'History', icon: 'history' },
    { path: '/alerts',  label: 'Alerts',  icon: 'alerts' },
  ] as const;

  let active = $derived(($page.url.pathname === '/' ? '/' : '/' + $page.url.pathname.split('/')[1]));
</script>

<nav class="tabbar" aria-label="Primary">
  <ul>
    {#each tabs as t}
      {@const isActive = t.path === active}
      <li>
        <a
          href={t.path}
          class:active={isActive}
          aria-current={isActive ? 'page' : undefined}
        >
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if t.icon === 'now'}
              <circle cx="9" cy="9" r="6.5" />
            {:else if t.icon === 'history'}
              <path d="M2.5 13 L6.5 8 L10 11 L15.5 4" />
            {:else}
              <path d="M9 3 L9 11" />
              <circle cx="9" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
            {/if}
          </svg>
          {#if isActive}<span>{t.label}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .tabbar {
    position: fixed;
    bottom: calc(20px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 5px;
    display: flex;
    gap: 4px;
    align-items: center;
    border-radius: 999px;
    background: rgba(10, 19, 32, 0.75);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    border: 1px solid var(--paper-line);
    box-shadow:
      0 12px 36px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(243, 237, 224, 0.05);
  }
  a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 999px;
    color: var(--paper-mute);
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 60;
    font-size: 0.85rem;
    text-decoration: none;
    transition:
      background 0.22s,
      color 0.22s,
      padding 0.22s;
  }
  a:hover {
    color: var(--paper);
  }
  a.active {
    background: var(--copper);
    color: var(--paper);
    padding: 10px 18px;
    font-variation-settings: 'opsz' 14, 'wght' 500, 'SOFT' 60;
    box-shadow: 0 4px 14px var(--copper-dim);
  }
  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
</style>
