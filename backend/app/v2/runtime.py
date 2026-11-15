"""Read aggregate runtime counters without a Docker socket or host mounts."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import httpx


def cpu_ticks(proc: Path) -> tuple[int, int] | None:
    try:
        with (proc / 'stat').open() as stats:
            name, *values = stats.readline().split()
        # Guest and guest_nice are already counted in user and nice.
        ticks = [int(value) for value in values[:8]]
        if name == 'cpu' and len(ticks) == 8:
            return sum(ticks), ticks[3] + ticks[4]
    except (OSError, ValueError):
        pass
    return None


def ram_percent(proc: Path) -> float | None:
    try:
        with (proc / 'meminfo').open() as info:
            values = {}
            for line in info:
                name, _, value = line.partition(':')
                if name in {'MemTotal', 'MemAvailable'}:
                    values[name] = int(value.split()[0])
        total, available = values['MemTotal'], values['MemAvailable']
        if total > 0 and 0 <= available <= total:
            return round(100 * (total - available) / total, 1)
    except (OSError, ValueError, KeyError, IndexError):
        pass
    return None


def bounded_percent(value) -> float | None:
    if type(value) in (int, float) and 0 <= value <= 100:
        return round(value, 1)
    return None


class RuntimeSnapshot:
    def __init__(self, gpu_url: str | None, gpu_token: str | None, proc: Path = Path('/proc')):
        self.gpu_url = gpu_url
        self.gpu_token = gpu_token
        self.proc = proc
        self.lock = asyncio.Lock()
        self.sampled_at = float('-inf')
        self.sample: dict[str, float | None] = {}

    async def cpu_percent(self):
        start = cpu_ticks(self.proc)
        if start is None:
            return None
        await asyncio.sleep(0.25)
        end = cpu_ticks(self.proc)
        if end is None:
            return None
        total, idle = end[0] - start[0], end[1] - start[1]
        return bounded_percent(100 * (total - idle) / total) if total > 0 else None

    async def gpu_percentages(self):
        if self.gpu_url:
            try:
                async with httpx.AsyncClient(timeout=1.5, follow_redirects=False) as client:
                    response = await client.get(
                        self.gpu_url.rstrip('/') + '/runtime',
                        headers={'Authorization': 'Bearer ' + (self.gpu_token or '')},
                    )
                    response.raise_for_status()
                    values = response.json()
                if isinstance(values, dict):
                    return bounded_percent(values.get('gpu_percent')), bounded_percent(values.get('vram_percent'))
            except (httpx.HTTPError, ValueError):
                pass
        return None, None

    async def get(self):
        async with self.lock:
            if time.monotonic() - self.sampled_at >= 4:
                cpu, (gpu, vram) = await asyncio.gather(self.cpu_percent(), self.gpu_percentages())
                self.sample = {'cpu_percent': cpu, 'ram_percent': ram_percent(self.proc),
                               'gpu_percent': gpu, 'vram_percent': vram}
                self.sampled_at = time.monotonic()
            return self.sample
