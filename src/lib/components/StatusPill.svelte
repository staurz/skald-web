<script lang="ts">
  type Variant = 'heating' | 'ready' | 'check' | 'error';
  let {
    variant = 'ready' as Variant,
    label,
    pulse = variant === 'heating',
  }: { variant?: Variant; label: string; pulse?: boolean } = $props();

  const palette = {
    heating: { fg: 'var(--copper)', bg: 'var(--copper-aura)', brd: 'var(--copper-dim)' },
    ready:   { fg: 'var(--moss)',   bg: 'rgba(138,166,141,0.18)', brd: 'rgba(138,166,141,0.5)' },
    check:   { fg: 'var(--amber)',  bg: 'rgba(217,164,96,0.18)',  brd: 'rgba(217,164,96,0.5)' },
    error:   { fg: 'var(--rust)',   bg: 'rgba(194,91,72,0.18)',   brd: 'rgba(194,91,72,0.5)' },
  } as const;

  let p = $derived(palette[variant]);
</script>

<span
  class="pill"
  style="--fg: {p.fg}; --bg: {p.bg}; --brd: {p.brd};"
>
  <span class="dot" class:anim-pulse={pulse}></span>
  {label}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--brd);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg);
    box-shadow: 0 0 10px var(--fg);
  }
</style>
