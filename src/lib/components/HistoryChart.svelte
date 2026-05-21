<script lang="ts">
  let {
    points,
    target,
    label = 'TEMPERATURE',
    height = 200,
  }: {
    points: number[];
    target?: number;
    label?: string;
    height?: number;
  } = $props();

  const W = 320;

  let H = $derived(height);
  let domain = $derived.by(() => {
    if (!points?.length) return { min: 30, max: 42 };
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    return { min: lo - pad, max: hi + pad };
  });

  function pt(i: number, v: number) {
    const x = (i / Math.max(1, points.length - 1)) * W;
    const y = H - ((v - domain.min) / (domain.max - domain.min)) * H;
    return [x, y] as const;
  }

  let pts = $derived(points.map((v, i) => pt(i, v)));

  let smoothD = $derived(
    pts.reduce((acc, [x, y], i, arr) => {
      if (i === 0) return `M ${x} ${y}`;
      const [px, py] = arr[i - 1];
      const c1x = px + (x - px) / 2;
      const c2x = x - (x - px) / 2;
      return `${acc} C ${c1x} ${py} ${c2x} ${y} ${x} ${y}`;
    }, '')
  );

  let fillD = $derived(`${smoothD} L ${W} ${H} L 0 ${H} Z`);

  let gridLines = $derived.by(() => {
    const lines: number[] = [];
    const lo = Math.ceil(domain.min);
    const hi = Math.floor(domain.max);
    for (let t = lo; t <= hi; t++) lines.push(t);
    return lines;
  });

  let targetY = $derived(
    target != null ? H - ((target - domain.min) / (domain.max - domain.min)) * H : null
  );

  let last = $derived(pts.length > 0 ? pts[pts.length - 1] : null);
</script>

<div class="chart-wrap">
  <svg viewBox={`0 0 ${W} ${H + 24}`} preserveAspectRatio="none" aria-label={label}>
    <defs>
      <linearGradient id="glod-history-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--copper)" stop-opacity="0.4" />
        <stop offset="100%" stop-color="var(--copper)" stop-opacity="0" />
      </linearGradient>
      <filter id="glod-history-glow">
        <feGaussianBlur stdDeviation="1.5" />
      </filter>
    </defs>

    {#each gridLines as t}
      {@const y = H - ((t - domain.min) / (domain.max - domain.min)) * H}
      <line
        x1="0"
        x2={W}
        y1={y}
        y2={y}
        stroke="var(--paper-line)"
        stroke-width="0.5"
        stroke-dasharray="1 4"
      />
      <text
        x={W - 2}
        y={y - 3}
        text-anchor="end"
        font-family="var(--font-mono)"
        font-size="9"
        fill="var(--paper-faint)"
      >
        {t}°
      </text>
    {/each}

    <path d={fillD} fill="url(#glod-history-fill)" />
    <path
      d={smoothD}
      fill="none"
      stroke="var(--copper)"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      filter="url(#glod-history-glow)"
      opacity="0.55"
    />
    <path
      d={smoothD}
      fill="none"
      stroke="var(--copper)"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    {#if targetY != null}
      <line
        x1="0"
        x2={W}
        y1={targetY}
        y2={targetY}
        stroke="var(--paper-faint)"
        stroke-width="0.5"
        stroke-dasharray="3 4"
      />
    {/if}

    {#if last}
      <circle cx={last[0]} cy={last[1]} r="9" fill="none" stroke="var(--copper)" stroke-width="0.8" opacity="0.4" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--copper)" />
    {/if}
  </svg>
</div>

<style>
  .chart-wrap {
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
</style>
