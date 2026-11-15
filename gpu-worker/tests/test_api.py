from fastapi.testclient import TestClient

from app import main


def test_health_remains_available_for_container_orchestration(monkeypatch) -> None:
    monkeypatch.setattr(main, "token", "secret")
    response = TestClient(main.app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_rank_requires_the_configured_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(main, "token", "secret")
    response = TestClient(main.app).post(
        "/rank",
        json={"query": "coupon", "documents": [], "limit": 1},
    )
    assert response.status_code == 401


def test_runtime_reports_gpu_percentages_behind_worker_auth(monkeypatch) -> None:
    from subprocess import CompletedProcess
    from types import SimpleNamespace

    monkeypatch.setattr(main, "token", "secret")
    monkeypatch.setattr(main.ranker, "accelerator", "cuda")
    cuda = SimpleNamespace(deviceGetPCIBusId=lambda index: "0000:01:00.0", CUDARuntimeError=RuntimeError)
    monkeypatch.setattr(main.ranker, "xp", SimpleNamespace(cuda=SimpleNamespace(runtime=cuda)))

    def measure(command, **_options):
        assert "--id=0000:01:00.0" in command
        return CompletedProcess(command, 0, "0, 1024, 4096\n")

    monkeypatch.setattr(main.subprocess, "run", measure)
    client = TestClient(main.app)
    assert client.get("/runtime").status_code == 401
    response = client.get("/runtime", headers={"Authorization": "Bearer secret"})
    assert response.json() == {"gpu_percent": 0, "vram_percent": 25}
