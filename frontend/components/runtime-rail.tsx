"use client";

import { useEffect, useState } from 'react';

import { v2Request } from '@/lib/v2-api';

type Usage = {
  cpu_percent?: number | null;
  gpu_percent?: number | null;
  ram_percent?: number | null;
  vram_percent?: number | null;
};
type BrowserMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number };

const icons = {
  cpu: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
  gpu: 'M3 6h18v12H3z M8 18v2m8-2v2 M3 10H1m0 4h2 M17 9h1m-1 3h1m-1 3h1 M14 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
  ram: 'M2 8h20v9H2z M5 17v3m4-3v3m6-3v3m4-3v3 M5 11h3v3H5zm6 0h3v3h-3zm6 0h2v3h-2z',
  vram: 'M5 9h15v10H5z M3 16H2V5h16v2 M8 12h3v4H8zm6 0h3v4h-3z',
  web: 'M3 5h18v14H3z M3 9h18 M6 7h1m2 0h1',
};

function asPercent(value: number | null | undefined) {
  return typeof value === 'number' && value >= 0 && value <= 100 ? value.toFixed(1) + '%' : '—';
}

export function RuntimeRail() {
  const [usage, setUsage] = useState<Usage>({});
  const [heap, setHeap] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function sample() {
      const memory = (window.performance as Performance & { memory?: BrowserMemory }).memory;
      setHeap(memory && memory.jsHeapSizeLimit > 0 ? 100 * memory.usedJSHeapSize / memory.jsHeapSizeLimit : null);
      try {
        const result = await v2Request<{ utilization?: Usage }>('/api/v2/runtime');
        if (mounted) setUsage(result.utilization ?? {});
      } catch {
        if (mounted) setUsage({});
      } finally {
        if (mounted) timer = setTimeout(() => { void sample(); }, 5000);
      }
    }
    void sample();
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  const metrics = [
    { key: 'cpu', label: 'CPU', hint: 'Host CPU utilization', value: usage.cpu_percent },
    { key: 'gpu', label: 'GPU', hint: 'GPU utilization on the ranking worker', value: usage.gpu_percent },
    { key: 'ram', label: 'RAM', hint: 'Host RAM in use', value: usage.ram_percent },
    { key: 'vram', label: 'VRAM', hint: 'GPU memory in use on the ranking worker', value: usage.vram_percent },
    { key: 'web', label: 'Heap', hint: 'Browser JavaScript heap used as a share of its limit', value: heap },
  ] as const;
  return <section className="runtime-rail" aria-label="Resource usage">
    <h2>Resource usage</h2>
    <dl>
      {metrics.map(({ key, label, hint, value }) => {
        const reading = asPercent(value);
        return <div key={key} title={hint}>
          <dt><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[key]} /></svg>
            {label}<span className="sr-only"> ({hint})</span></dt>
          <dd>{reading === '—' ? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></> : reading}</dd>
        </div>;
      })}
    </dl>
  </section>;
}
