<script lang="ts">
  type Kind = 'info' | 'warn' | 'alert';
  let {
    kind = 'info' as Kind,
    title,
    detail,
    time,
  }: {
    kind?: Kind;
    title: string;
    detail?: string;
    time: string;
  } = $props();

  let flag = $derived(kind !== 'info');
  let accent = $derived(kind === 'alert' ? 'var(--rust)' : kind === 'warn' ? 'var(--amber)' : 'var(--pearl)');
  let accentRgb = $derived(kind === 'alert' ? '194,91,72' : kind === 'warn' ? '217,164,96' : '212,200,180');
</script>

<div
  class="row"
  class:flagged={flag}
  style="--accent: {accent}; --accent-rgb: {accentRgb};"
>
  <div class="mark" aria-hidden="true">
    {#if flag}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1 L13 13 L1 13 Z" stroke={accent} stroke-width="1.2" stroke-linejoin="round" />
        <line x1="7" y1="6" x2="7" y2="8.5" stroke={accent} stroke-width="1.2" stroke-linecap="round" />
        <circle cx="7" cy="10" r="0.8" fill={accent} />
      </svg>
    {:else}
      <span class="info-dot"></span>
    {/if}
  </div>

  <div class="body">
    <div class="row-head">
      <span class="title">{title}</span>
      <span class="time">{time}</span>
    </div>
    {#if detail}<div class="detail">{detail}</div>{/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    gap: 14px;
    padding: 14px 16px;
    border-radius: var(--r-md);
    background: rgba(26, 43, 68, 0.5);
    border: 1px solid var(--paper-line);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .row.flagged {
    background: linear-gradient(
      90deg,
      rgba(var(--accent-rgb), 0.2),
      rgba(26, 43, 68, 0.5)
    );
    border-color: rgba(var(--accent-rgb), 0.4);
  }

  .mark {
    flex-shrink: 0;
    margin-top: 4px;
    width: 14px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  .info-dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pearl);
    opacity: 0.5;
    margin-top: 3px;
  }

  .body {
    flex: 1;
    min-width: 0;
  }
  .row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 24, 'wght' 500, 'SOFT' 60;
    font-size: 1rem;
    color: var(--paper);
    letter-spacing: -0.01em;
  }
  .time {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.16em;
    color: var(--paper-mute);
    flex-shrink: 0;
  }
  .row.flagged .time {
    color: var(--accent);
  }
  .detail {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 14, 'wght' 400, 'SOFT' 50;
    font-size: 0.88rem;
    color: var(--paper-soft);
    margin-top: 3px;
    line-height: 1.45;
  }
</style>
