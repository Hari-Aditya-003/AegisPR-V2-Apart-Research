import json
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.evaluation.seeded_dataset import load_cases
from app.v2.api import create_app
from app.v2.evaluation import run_seeded, validate_external_manifest
from app.v2.evidence import ReceiptSigner
from app.v2.execution import RemoteFixtureExecutor
from app.v2.github_app import GitHubAppPublisher, pinned_pull_request, verify_webhook
from app.v2.models import GatewayBudget, ModelGateway
from app.v2.service import ReviewService


def config(tmp_path, **kwargs):
    return Settings(data_path=tmp_path / 'runs.sqlite3', v2_signing_key_path=tmp_path / 'key.pem', **kwargs)


def transport(monkeypatch, handler):
    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.asyncio
async def test_two_provider_families_share_a_ledger_and_cache_validated_outputs(tmp_path, monkeypatch):
    gateway = ModelGateway(config(tmp_path, nebius_api_key='fake-nebius', vultr_api_key='fake-vultr', v2_enable_models=True))
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': '{"findings":[]}'}}],
                                         'usage': {'prompt_tokens': 60, 'completion_tokens': 10}})
    transport(monkeypatch, handler)
    first = await gateway.review('one', 'correctness', 'patch', ['E1'], allow_external=True, changed={})
    second = await gateway.review('one', 'critic', 'patch', ['E1'], allow_external=True, changed={})
    cached = await gateway.review('two', 'correctness', 'patch', ['E1'], allow_external=True, changed={})
    assert first['family'] != second['family'] and first['provider'] != second['provider']
    assert cached['cache_hit'] and len(requests) == 2
    assert gateway.budget.summary()['calls'] == 2
    assert gateway.budget.summary()['cache_hits'] == 1
    assert {request.url.host for request in requests} == {'api.tokenfactory.nebius.com', 'api.vultrinference.com'}


@pytest.mark.asyncio
@pytest.mark.parametrize('code', [401, 429, 500])
async def test_provider_errors_never_retry_and_unknown_billing_keeps_reservation(tmp_path, monkeypatch, code):
    gateway = ModelGateway(config(tmp_path, nebius_api_key='fake', v2_enable_models=True))
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(code, json={'error': 'provider detail must not leak'})
    transport(monkeypatch, handler)
    with pytest.raises(ValueError, match='safely'):
        await gateway.review('one', 'triage', 'patch', ['E1'], allow_external=True)
    assert len(sent) == 1
    assert (gateway.budget.summary()['accounted_cost_usd'] > 0) == (code == 500)


@pytest.mark.asyncio
async def test_zero_budget_prevents_any_external_request(tmp_path, monkeypatch):
    gateway = ModelGateway(config(tmp_path, nebius_api_key='fake', v2_enable_models=True, v2_budget_usd='0'))
    transport(monkeypatch, lambda _: pytest.fail('No request should be sent'))
    with pytest.raises(ValueError, match='limit'):
        await gateway.review('one', 'correctness', 'patch', ['E1'], allow_external=True)
    assert gateway.budget.summary()['calls'] == 0
    with pytest.raises(ValueError):
        GatewayBudget._charge('unknown', 10, 10)


@pytest.mark.asyncio
async def test_remote_worker_checks_signature_nonce_and_dataset(tmp_path, monkeypatch):
    signer = ReceiptSigner(tmp_path / 'worker.pem')
    settings = config(tmp_path, v2_worker_url='http://worker.invalid', v2_worker_token='worker-secret', v2_worker_public_key=signer.public_key)
    service = ReviewService(settings)
    case = service.cases['py-coupon-floor']
    corrupt = False
    def handler(request):
        work = json.loads(request.content)
        executions = [{'branch': side, 'repeat': n, 'status': 'pass'} for side in ('base', 'head') for n in range(1, 4)]
        return httpx.Response(200, json=signer.sign({'nonce': 'wrong' if corrupt else work['nonce'], 'fixture_id': case.id,
            'repair': False, 'dataset_sha256': service.dataset_digest, 'executions': executions}))
    transport(monkeypatch, handler)
    assert len(await service.executor.execute(case)) == 6
    corrupt = True
    with pytest.raises(ValueError, match='stale'):
        await service.executor.execute(case)
    settings.v2_worker_public_key = ReceiptSigner(tmp_path / 'attacker.pem').public_key
    with pytest.raises(ValueError, match='signature'):
        await service.executor.execute(case)


@pytest.mark.asyncio
async def test_pinned_pr_rejects_concurrent_head_update_and_accounts_for_all_files(tmp_path, monkeypatch):
    settings = config(tmp_path)
    base, head = 'a' * 40, 'b' * 40
    url = 'https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/pull/1'
    pr = {'base': {'sha': base, 'repo': {'private': False}}, 'head': {'sha': head}, 'title': 'Test', 'changed_files': 1}
    changed = False
    def handler(request):
        if request.url.path.endswith('/files'):
            return httpx.Response(200, json=[{'filename': 'a.py', 'status': 'modified', 'patch': '@@ -1 +1 @@\n-old\n+new'}])
        return httpx.Response(200, json={**pr, 'head': {'sha': 'c' * 40 if changed else head}})
    transport(monkeypatch, handler)
    assert len((await pinned_pull_request(settings, url, base, head))['files']) == 1
    changed = True
    with pytest.raises(ValueError, match='changed'):
        await pinned_pull_request(settings, url, base, head)


@pytest.mark.asyncio
async def test_external_review_is_analysis_only_and_bad_model_citations_do_not_create_proof(tmp_path, monkeypatch):
    from app.v2 import service as module
    service = ReviewService(config(tmp_path, v2_enable_models=True, nebius_api_key='fake'))
    async def pr(*args):
        return {'title': 'Review', 'files': [{'filename': 'auth.py', 'status': 'modified', 'patch': '@@ -1 +1 @@\n-old\n+eval(user)'}]}
    monkeypatch.setattr(module, 'pinned_pull_request', pr)
    monkeypatch.setattr(service.gateway, 'review', AsyncMock(side_effect=ValueError('Citation rejected')))
    payload = {'mode': 'pr', 'pull_request_url': 'https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/pull/1',
               'base_sha': 'a' * 40, 'head_sha': 'b' * 40, 'use_models': True, 'allow_external_code': True}
    first = service.create(payload); await service.execute(first['id'])
    second = service.create(payload); await service.execute(second['id'])
    run = service.store.get(second['id'])
    assert run['status'] == 'ANALYSIS_ONLY' and not run['executions']
    assert run['incremental']['persisting']
    assert all(item['status'] == 'blocked' for item in run['model_invocations'])


@pytest.mark.asyncio
async def test_fixture_benchmark_has_real_raw_runs_and_no_model_cost(tmp_path):
    service = ReviewService(config(tmp_path))
    report = await run_seeded(service, repeats=1)
    assert report['unique_cases'] == 12 and len(report['raw']) == 12
    assert report['cost_usd'] == 0 and len(service.store.benchmarks()) == 1
    assert all(service.store.get(row['run_id'])['receipt'] for row in report['raw'])


def test_external_benchmark_manifest_requires_exact_shas(tmp_path):
    path = tmp_path / 'external.json'
    path.write_text(json.dumps({'source': 'https://github.com/microsoft/ReviewBench', 'cases': [
        {'base_sha': 'main', 'head_sha': 'b' * 40, 'label': 'unknown'}]}))
    with pytest.raises(ValueError, match='pin'):
        validate_external_manifest(path)
    payload = json.loads(path.read_text()); payload['cases'][0]['base_sha'] = 'a' * 40
    path.write_text(json.dumps(payload))
    assert validate_external_manifest(path)['executed'] is False


def test_worker_rejects_unauthorized_and_arbitrary_work(tmp_path, monkeypatch):
    from app.v2 import worker
    monkeypatch.setenv('V2_WORKER_TOKEN', 'fixture-token')
    monkeypatch.setenv('V2_WORKER_SIGNING_KEY', str(tmp_path / 'worker.pem'))
    client = TestClient(worker.app)
    work = {'fixture_id': 'py-coupon-floor', 'nonce': 'a' * 32}
    assert client.post('/execute', json=work).status_code == 401
    auth = {'Authorization': 'Bearer fixture-token'}
    assert client.post('/execute', json={**work, 'fixture_id': '../source'}, headers=auth).status_code == 422
    assert client.post('/execute', json={**work, 'command': 'arbitrary'}, headers=auth).status_code == 422
    assert client.post('/execute', json=work, headers=auth).status_code == 503
    assert client.get('/health').json()['arbitrary_repository_execution'] is False


def test_github_publishing_is_off_without_explicit_owner_configuration(tmp_path):
    publisher = GitHubAppPublisher(config(tmp_path))
    with pytest.raises(ValueError, match='credentials'):
        publisher.jwt()
    with pytest.raises(ValueError, match='disabled'):
        __import__('asyncio').run(publisher.publish({}, '42'))

