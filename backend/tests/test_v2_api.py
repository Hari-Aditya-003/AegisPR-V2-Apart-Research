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
    assert len(run['executions']) == 6
    receipt = client.get('/api/v2/demo/' + run_id + '/receipt').json()
    assert receipt['payload']['id'] == run_id
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

