import hashlib
import hmac
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.v2.api import create_app
from app.v2.models import ModelGateway


def settings(tmp_path, **kwargs):
    return Settings(data_path=tmp_path / 'runs.sqlite3', v2_signing_key_path=tmp_path / 'key.pem', **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize('envelope', [None, [], {'usage': None, 'choices': []}])
async def test_malformed_provider_envelopes_fail_closed_and_keep_reservation(tmp_path, monkeypatch, envelope):
    gateway = ModelGateway(settings(tmp_path, nebius_api_key='fake-private-key', v2_enable_models=True))
    client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=envelope))
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client(transport=transport, **kwargs))
    with pytest.raises(ValueError):
        await gateway.review('run', 'correctness', 'diff', ['E1'], allow_external=True, changed={'a.py': {1}})
    assert gateway.budget.summary()['calls'] == 1
    assert gateway.budget.summary()['accounted_cost_usd'] > 0


def test_large_valid_receipt_can_be_verified(tmp_path):
    app = create_app(settings(tmp_path))
    receipt = app.state.reviews.signer.sign({'diff': 'x' * 100000})
    response = TestClient(app).post('/api/v2/verify-receipt', json=receipt)
    assert response.status_code == 200
    assert response.json()['verified'] is True


@pytest.mark.asyncio
async def test_review_records_actual_context_accelerator(tmp_path, monkeypatch):
    from app.services.context_ranker import ContextRanker, ContextRanking
    async def rank(self, query, documents, limit=20):
        return ContextRanking(documents=documents, accelerator='cuda', device='test-device')
    monkeypatch.setattr(ContextRanker, 'rank', rank)
    from app.v2.service import ReviewService
    service = ReviewService(settings(tmp_path))
    run = service.create({'mode': 'fixture', 'fixture_id': 'py-coupon-floor'})
    await service.execute(run['id'])
    measured = service.store.get(run['id'])
    assert measured['context_accelerator'] == 'cuda'
    assert any(event['stage'] == 'context' for event in measured['events'])


def test_docker_cli_is_resolved_before_sanitizing_the_guest_environment(tmp_path, monkeypatch):
    import subprocess
    import shutil
    from app.v2.execution import FixtureExecutor
    from app.v2.service import ReviewService
    case = ReviewService(settings(tmp_path)).cases['py-coupon-floor']
    monkeypatch.setattr(shutil, 'which', lambda name: '/usr/local/bin/' + name)
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        if 'run' in command:
            assert command[0] == '/usr/local/bin/docker'
            return subprocess.CompletedProcess(command, 0, '{"observations":[0,15]}', '')
        return subprocess.CompletedProcess(command, 0, '', '')
    monkeypatch.setattr(subprocess, 'run', run)
    results = FixtureExecutor(docker_image='python@sha256:' + 'a' * 64).execute(case)
    assert len(results) == 6
    assert all(command[0] == '/usr/local/bin/docker' for command in calls)


def test_webhook_retry_after_temporary_admission_failure_is_not_lost(tmp_path, monkeypatch):
    app = create_app(settings(tmp_path, github_webhook_secret='webhook-secret', github_installation_ids='42'))
    service = app.state.reviews
    execute = AsyncMock()
    monkeypatch.setattr(service, 'execute', execute)
    first = service.create({'mode': 'fixture', 'fixture_id': 'py-coupon-floor'})
    second = service.create({'mode': 'fixture', 'fixture_id': 'py-coupon-floor'})
    body = json.dumps({'action': 'opened', 'repository': {'full_name': 'Hari-Aditya-003/AegisPR-V2-Apart-Research'},
                       'installation': {'id': 42}, 'pull_request': {'html_url': 'https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/pull/1',
                       'base': {'sha': 'a' * 40}, 'head': {'sha': 'b' * 40}}}).encode()
    headers = {'X-Hub-Signature-256': 'sha256=' + hmac.new(b'webhook-secret', body, hashlib.sha256).hexdigest(),
               'X-GitHub-Delivery': 'delivery-retry', 'X-GitHub-Event': 'pull_request'}
    client = TestClient(app)
    assert client.post('/api/github/webhook', content=body, headers=headers).status_code == 422
    first['status'] = second['status'] = 'ANALYSIS_ONLY'
    service.store.save(first); service.store.save(second)
    response = client.post('/api/github/webhook', content=body, headers=headers)
    assert response.json()['status'] == 'accepted'
    assert client.post('/api/github/webhook', content=body, headers=headers).json()['status'] == 'duplicate'
    assert execute.await_count == 1

