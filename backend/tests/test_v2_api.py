import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from app.config import Settings
from app.v2.api import create_app


def make_app(tmp_path, **kwargs):
    return create_app(Settings(data_path=tmp_path / 'v2.sqlite3', v2_signing_key_path=tmp_path / 'sign.pem', **kwargs))


def test_public_demo_generates_and_verifies_new_receipt(tmp_path):
    client = TestClient(make_app(tmp_path, app_env='production', api_access_token='private-owner-code123'))
    assert client.get('/api/v2/reviews').status_code == 401
    result = client.post('/api/v2/demo', json={'fixture_id': 'py-coupon-floor'})
    assert result.status_code == 202
    run_id = result.json()['id']
    run = client.get('/api/v2/demo/' + run_id).json()
    assert run['status'] == 'REGRESSION_FOUND'
    assert all(check['resources']['cpu_us'] > 0 and check['resources']['peak_rss_bytes'] > 0
               for check in run['executions'])
    assert run['receipt']['payload']['executions'] == run['executions']
    runtime = client.get('/api/v2/runtime')
    assert runtime.status_code == 200
    assert runtime.json()['peak_rss_bytes'] > 0
    assert len(run['executions']) == 6
    receipt = client.get('/api/v2/demo/' + run_id + '/receipt').json()
    assert receipt['payload']['id'] == run_id
    assert client.get('/api/v2/demo/' + run_id + '/sarif').status_code == 200
    assert client.post('/api/v2/demo', json={'fixture_id': 'py-coupon-floor', 'use_models': True}).status_code == 422
    assert client.get('/api/v2/reviews/' + run_id + '/sarif').status_code == 401


def test_private_fixtures_are_not_exposed_through_public_demo(tmp_path):
    app = make_app(tmp_path)
    client = TestClient(app)
    run = client.post('/api/v2/reviews', json={'mode': 'fixture', 'fixture_id': 'py-coupon-floor'}).json()
    assert client.get('/api/v2/demo/' + run['id']).status_code == 404


def test_webhook_requires_signature_and_deduplicates(tmp_path):
    app = make_app(tmp_path, github_webhook_secret='test-webhook-secret', github_installation_ids='42')
    client = TestClient(app)
    body = json.dumps({'action': 'opened', 'repository': {'full_name': 'other/repo'}, 'installation': {'id': 42}}).encode()
    headers = {'X-Hub-Signature-256': 'sha256=' + hmac.new(b'test-webhook-secret', body, hashlib.sha256).hexdigest(),
               'X-GitHub-Delivery': 'delivery-1', 'X-GitHub-Event': 'pull_request'}
    assert client.post('/api/github/webhook', content=body).status_code == 401
    assert client.post('/api/github/webhook', content=body, headers=headers).json()['status'] == 'ignored'
    assert client.post('/api/github/webhook', content=body, headers=headers).json()['status'] == 'duplicate'


def test_request_size_is_bounded(tmp_path):
    client = TestClient(make_app(tmp_path))
    assert client.post('/api/v2/demo', content=b'x' * 70000).status_code == 413


def test_public_reference_omits_private_fields(tmp_path):
    client = TestClient(make_app(tmp_path, app_env='production', api_access_token='owner-secret-code'))
    data = client.get('/api/v2/learn').json()
    assert data['benchmark']['metrics']['cases'] == 36
    assert not {'raw', 'id'} & data['benchmark'].keys()
    assert all(set(model) == {'provider', 'model', 'family', 'input', 'output', 'source'} for model in data['models'])
    assert client.get('/api/v2/benchmarks/job').status_code == 401
    assert client.post('/api/v2/benchmarks/job', json={'repeats': 1}).status_code == 401


def test_owner_benchmark_queues_and_reports_completion(tmp_path, monkeypatch):
    async def evaluated(service, *, repeats, on_progress):
        assert repeats == 1
        on_progress(len(service.cases))
        return {'id': 'fixture-report'}

    monkeypatch.setattr('app.v2.api.run_seeded', evaluated)
    client = TestClient(make_app(tmp_path, app_env='production', api_access_token='owner-secret-code'))
    headers = {'Authorization': 'Bearer owner-secret-code'}
    queued = client.post('/api/v2/benchmarks/job', json={'repeats': 1}, headers=headers)
    assert queued.status_code == 202
    assert queued.json()['status'] == 'running'
    finished = client.get('/api/v2/benchmarks/job', headers=headers).json()
    assert finished['id'] == queued.json()['id']
    assert finished['status'] == 'completed'
    assert finished['completed'] == finished['total'] == 12
    assert finished['report_id'] == 'fixture-report'


def test_aggregate_telemetry_requires_owner_code_or_public_opt_in(tmp_path, monkeypatch):
    async def sample(_snapshot):
        return {'cpu_percent': 15, 'ram_percent': 25}

    monkeypatch.setattr('app.v2.api.RuntimeSnapshot.get', sample)
    config = {'api_access_token': 'private-owner-code123', 'app_env': 'production'}
    client = TestClient(make_app(tmp_path, **config))
    assert client.get('/api/v2/runtime').json()['utilization'] == {}
    headers = {'Authorization': 'Bearer ' + config['api_access_token']}
    assert client.get('/api/v2/runtime', headers=headers).json()['utilization']['cpu_percent'] == 15
    public = TestClient(make_app(tmp_path, v2_public_utilization=True, **config))
    assert public.get('/api/v2/runtime').json()['utilization']['ram_percent'] == 25
