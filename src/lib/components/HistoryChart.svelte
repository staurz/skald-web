<script lang="ts">
  type Point = { ts_bucket: number; avg: number; min: number; max: number };

  let { points = [], yLabel = '' }: { points?: Point[]; yLabel?: string } = $props();

  const W = 600;
  const H = 200;
  const padX = 12;
  const padTop = 22;
  const padBottom = 26;

  let xs = $derived(points.map((p) => p.ts_bucket));
  let ys = $derived(points.map((p) => p.avg));
  let xMin = $derived(xs[0] ?? 0);
  let xMax = $derived(xs[xs.length - 1] ?? 1);
  let yMin = $derived(ys.length ? Math.min(...ys) : 0);
  let yMax = $derived(ys.length ? Math.max(...ys) : 1);

  // Provide vertical headroom so the line doesn't kiss the chart edges.
  let yLo = $derived(yMin - Math.max((yMax - yMin) * 0.1, 0.5));
  let yHi = $derived(yMax + Math.max((yMax - yMin) * 0.1, 0.5));

  function fx(x: number) {
    return padX + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - padX * 2);
  }
  function fy(y: number) {
    return padTop + (H - padTop - padBottom) - ((y - yLo) / Math.max(0.001, yHi - yLo)) * (H - padTop - padBottom);
  }

  let pathLine = $derived(
    ys.length ? 'M' + xs.map((x, i) => `${fx(x).toFixed(2)},${fy(ys[i]).toFixed(2)}`).join(' L') : '',
  );
  let pathFill = $derived(
    ys.length
      ? `M${fx(xs[0]).toFixed(2)},${(H - padBottom).toFixed(2)} ` +
          'L' +
          xs.map((x, i) => `${fx(x).toFixed(2)},${fy(ys[i]).toFixed(2)}`).join(' L') +
          ` L${fx(xs[xs.length - 1]).toFixed(2)},${(H - padBottom).toFixed(2)} Z`
      : '',
  );

  let lastX = $derived(ys.length ? fx(xs[xs.length - 1]) : 0);
  let lastY = $derived(ys.length ? fy(ys[ys.length - 1]) : 0);

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="spark tall">
  <svg viewBox="0 0 600 200" preserveAspectRatio="none">
    <defs>
      <linearGradient id="sparkGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#cc7c3a" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#cc7c3a" stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if pathLine}
      <path class="spark-fill" d={pathFill} />
      <path class="spark-line" d={pathLine} />
      <circle class="spark-current" cx={lastX} cy={lastY} r="3" />
      <text class="spark-axis-label" x={padX} y={H - 8}>{fmtTime(xs[0])}</text>
      <text class="spark-axis-label" x={W - padX} y={H - 8} text-anchor="end">{fmtTime(xs[xs.length - 1])}</text>
      <text class="spark-axis-label" x={padX} y="14">{yLabel} {yLo.toFixed(1)}–{yHi.toFixed(1)}</text>
    {:else}
      <text x="300" y="105" text-anchor="middle" class="spark-axis-label" style="font-size:11px;">awaiting data</text>
    {/if}
  </svg>
</div>
