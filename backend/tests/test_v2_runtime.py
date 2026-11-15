import pytest

from app.v2.runtime import RuntimeSnapshot, cpu_ticks, ram_percent


def test_linux_counters_use_available_memory_and_exclude_double_counted_guest_ticks(tmp_path):
    (tmp_path / 'stat').write_text('cpu 10 10 10 50 10 5 2 3 8 4\n')
    (tmp_path / 'meminfo').write_text('MemTotal: 1000 kB\nMemAvailable: 750 kB\n')
    assert cpu_ticks(tmp_path) == (100, 60)
    assert ram_percent(tmp_path) == 25


@pytest.mark.asyncio
async def test_snapshot_samples_cpu_deltas_and_returns_missing_gpu_metrics(tmp_path, monkeypatch):
    ticks = iter([(100, 60), (200, 120)])
    monkeypatch.setattr('app.v2.runtime.cpu_ticks', lambda proc: next(ticks))
    snapshot = RuntimeSnapshot(None, None, tmp_path)
    assert await snapshot.get() == {'cpu_percent': 40, 'ram_percent': None, 'gpu_percent': None, 'vram_percent': None}
    assert (await snapshot.get())['cpu_percent'] == 40
