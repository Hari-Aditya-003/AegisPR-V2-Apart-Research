"use client";

import { useEffect, useState } from 'react';

import { v2Request } from '@/lib/v2-api';
import type { Review } from '@/lib/v2-types';

type Runtime = { label: string; cpu_seconds: number; peak_rss_bytes: number };

const mib = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MiB';

export function RuntimePanel({ run }: { run?: Review }) {
  const [api, setApi] = useState<Runtime | null>(null);
  const [heap, setHeap] = useState<number>();
  useEffect(() => {
    let mounted = true;
    async function sample() {
      const memory = (window.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      setHeap(memory?.usedJSHeapSize);
      try {
        const result = await v2Request<Runtime>('/api/v2/runtime');
        if (mounted) setApi(result);
      } catch {
        if (mounted) setApi(null);
      }
    }
    void sample();
    const timer = setInterval(() => { void sample(); }, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const checks = run?.executions.concat(run.repair?.checks ?? []).flatMap(check => check.resources ?? []) ?? [];
  const gpu = run?.ranking_resources;
  return <section className="v2-panel v2-runtime" aria-label="Resource usage">
    <h2>Resource usage</h2>
    <dl className="v2-settings-list">
      <div><dt>API host</dt><dd>{api?.label ?? 'Unavailable'}</dd></div>
      <div><dt>API CPU time</dt><dd>{api ? api.cpu_seconds.toFixed(2) + ' s' : 'Unavailable'}</dd></div>
      <div><dt>API peak RAM</dt><dd>{api ? mib(api.peak_rss_bytes) : 'Unavailable'}</dd></div>
      <div><dt>Browser JS heap</dt><dd>{heap === undefined ? 'Unavailable in this browser' : mib(heap)}</dd></div>
      {run && <>
        <div><dt>Fixture CPU time</dt><dd>{checks.length ? (checks.reduce((sum, check) => sum + check.cpu_us, 0) / 1000).toFixed(1) + ' ms' : 'No sample'}</dd></div>
        <div><dt>Fixture peak RAM</dt><dd>{checks.length ? mib(Math.max(...checks.map(check => check.peak_rss_bytes))) : 'No sample'}</dd></div>
        <div><dt>Ranking accelerator</dt><dd>{gpu?.device ?? gpu?.accelerator ?? 'No sample'}</dd></div>
        <div><dt>Device VRAM after ranking</dt><dd>{gpu?.vram_used_bytes != null && gpu.vram_total_bytes != null ? `${mib(gpu.vram_used_bytes)} / ${mib(gpu.vram_total_bytes)}` : 'No sample'}</dd></div>
        <div><dt>Provider inference</dt><dd>{run.cost.calls ? `${run.cost.calls} calls · ${run.cost.input_tokens + run.cost.output_tokens} tokens` : '0 requests'}</dd></div>
      </>}
    </dl>
    <p>API counters cover the process since startup. Fixture counters cover the check processes. GPU VRAM is device-wide. Browser memory covers the JavaScript heap. Provider hardware and browser CPU/GPU are unavailable.</p>
  </section>;
}
