<script lang="ts">
  type Point = { ts_bucket: number; avg: number; min: number; max: number };

  let { points = [], yLabel = '' }: { points?: Point[]; yLabel?: string } = $props();

  let xs = $derived(points.map((p) => p.ts_bucket));
  let ys = $derived(points.map((p) => p.avg));
  let xMin = $derived(xs[0] ?? 0);
  let xMax = $derived(xs[xs.length - 1] ?? 1);
  let yMin = $derived(ys.length ? Math.min(...ys) : 0);
  let yMax = $derived(ys.length ? Math.max(...ys) : 1);

  function fx(x: number) {
    return ((x - xMin) / Math.max(1, xMax - xMin)) * 600;
  }
  function fy(y: number) {
    return 200 - ((y - yMin) / Math.max(0.001, yMax - yMin)) * 180;
  }

  let path = $derived(
    ys.length ? 'M' + xs.map((x, i) => `${fx(x)},${fy(ys[i])}`).join(' L') : '',
  );
</script>

<svg viewBox="0 0 600 200" class="w-full bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 text-sky-600 dark:text-sky-400">
  {#if path}
    <path d={path} fill="none" stroke="currentColor" stroke-width="2" />
    <text x="8" y="18" class="text-xs fill-gray-500">{yLabel} {yMin.toFixed(1)}–{yMax.toFixed(1)}</text>
  {:else}
    <text x="300" y="105" text-anchor="middle" class="text-sm fill-gray-400">no data yet</text>
  {/if}
</svg>
