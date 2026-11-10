import copy
import hashlib
import hmac
import json

import pytest

from app.config import Settings
from app.v2.analysis import analyze_patch, normalize_sarif
from app.v2.evidence import ReceiptSigner, adjudicate
from app.v2.service import ReviewService
from app.v2.store import ReviewStore


def config(tmp_path):
    return Settings(data_path=tmp_path / 'runs.sqlite3', v2_signing_key_path=tmp_path / 'key.pem')


def test_receipt_detects_modification_and_requires_trusted_key(tmp_path):
    signer = ReceiptSigner(tmp_path / 'key.pem')
    bundle = signer.sign({'run_id': 'one', 'base_sha': 'a' * 40, 'events': [{'id': 'E1'}]})
    assert ReceiptSigner.verify(bundle, signer.public_key)
    altered = copy.deepcopy(bundle)
    altered['payload']['run_id'] = 'two'
    assert not ReceiptSigner.verify(altered, signer.public_key)
    other = ReceiptSigner(tmp_path / 'other.pem')
    assert not ReceiptSigner.verify(bundle, other.public_key)
    assert ReceiptSigner(tmp_path / 'key.pem').public_key == signer.public_key
    assert (tmp_path / 'key.pem').stat().st_mode & 0o077 == 0


@pytest.mark.parametrize('base,head,expected', [
    (['pass'] * 3, ['fail'] * 3, 'REGRESSION_FOUND'),
    (['pass'] * 3, ['fail', 'pass', 'fail'], 'INCONCLUSIVE'),
    (['fail'] * 3, ['fail'] * 3, 'PRE_EXISTING_FAILURE'),
    (['pass'] * 3, ['pass'] * 3, 'VERIFIED_WITHIN_SCOPE'),
    (['pass'], ['fail'], 'INCONCLUSIVE'),
    (['pass'] * 3, ['error'] * 3, 'ENVIRONMENT_ERROR'),
])
def test_proof_requires_repeated_stable_checks(base, head, expected):
    assert adjudicate(base, head, valid_contract=True, trusted_executor=True) == expected


def test_model_votes_cannot_supply_executable_proof():
    assert adjudicate(['pass'] * 3, ['fail'] * 3, valid_contract=False, trusted_executor=True) == 'BEHAVIOR_CHANGE_INTENT_UNKNOWN'
    assert adjudicate(['pass'] * 3, ['fail'] * 3, valid_contract=True, trusted_executor=False) == 'INCONCLUSIVE'


def test_coverage_accounts_for_skips_and_only_reports_changed_lines():
    files = [
        {'filename': 'auth.py', 'status': 'modified', 'patch': '@@ -1,1 +1,2 @@\n safe()\n+eval(user_input)'},
        {'filename': 'logo.png', 'status': 'modified'},
        {'filename': 'gone.py', 'status': 'removed'},
    ]
    coverage, findings = analyze_patch(files)
    assert len(coverage) == 3
    assert coverage[1]['state'] == 'skipped' and coverage[1]['reason']
    assert coverage[2]['state'] == 'skipped'
    assert findings[0]['line'] == 2 and findings[0]['category'] == 'security'
    assert findings[0]['status'] == 'SECURITY_OBSERVATION'


def test_sarif_validates_locations_filters_and_deduplicates():
    result = {'ruleId': 'py.eval', 'message': {'text': 'untrusted input'}, 'locations': [
        {'physicalLocation': {'artifactLocation': {'uri': 'auth.py'}, 'region': {'startLine': 2}}}
    ]}
    sarif = {'runs': [{'results': [result, copy.deepcopy(result)]}]}
    assert len(normalize_sarif(sarif, {'auth.py': {2}})) == 1
    assert normalize_sarif(sarif, {'auth.py': {4}}) == []
    result['locations'][0]['physicalLocation']['artifactLocation']['uri'] = '../../secret'
    assert normalize_sarif(sarif, {'../../secret': {2}}) == []


def test_webhook_store_rejects_replay_with_changed_payload(tmp_path):
    store = ReviewStore(tmp_path / 'v2.sqlite3')
    assert store.claim_delivery('delivery-1', 'a' * 64)
    assert not store.claim_delivery('delivery-1', 'a' * 64)
    with pytest.raises(ValueError, match='different'):
        store.claim_delivery('delivery-1', 'b' * 64)


@pytest.mark.asyncio
async def test_safe_demo_runs_new_evidence_signs_and_repair_is_explicit(tmp_path):
    service = ReviewService(config(tmp_path))
    run = service.create({'mode': 'fixture', 'fixture_id': 'py-coupon-floor'})
    await service.execute(run['id'])
    completed = service.store.get(run['id'])
    assert completed['status'] == 'REGRESSION_FOUND'
    assert len(completed['executions']) == 6
    assert completed['cost']['calls'] == 0
    assert completed['base_sha'] != completed['head_sha']
    assert ReceiptSigner.verify(completed['receipt'], service.signer.public_key)
    assert completed['repair'] is None
    repaired = await service.repair(run['id'])
    assert repaired['repair']['status'] == 'FIX_VERIFIED'
    assert repaired['repair']['write_back'] is False
    assert 'prewritten' in repaired['repair']['provenance'].lower()
    assert ReceiptSigner.verify(repaired['receipt'], service.signer.public_key)
    assert completed['receipt']['payload']['repair'] is None


@pytest.mark.asyncio
async def test_feedback_does_not_mutate_signed_evidence(tmp_path):
    service = ReviewService(config(tmp_path))
    run = service.create({'mode': 'fixture', 'fixture_id': 'py-coupon-floor'})
    await service.execute(run['id'])
    before = service.store.get(run['id'])['receipt']
    finding = service.store.get(run['id'])['findings'][0]['id']
    service.feedback(run['id'], finding, 'acknowledged')
    assert service.store.get(run['id'])['receipt'] == before
    with pytest.raises(ValueError):
        service.feedback(run['id'], 'unknown', 'suppressed')


def test_rejects_arbitrary_fixture_and_unpinned_review(tmp_path):
    service = ReviewService(config(tmp_path))
    with pytest.raises(ValueError):
        service.create({'mode': 'fixture', 'fixture_id': '../anything'})
    with pytest.raises(ValueError):
        service.create({'mode': 'pr', 'pull_request_url': 'https://github.com/a/b/pull/1'})


def test_signed_webhook_validates_exact_bytes():
    from app.v2.github_app import verify_webhook
    body = b'{"action":"opened"}'
    signature = 'sha256=' + hmac.new(b'secret', body, hashlib.sha256).hexdigest()
    assert verify_webhook(body, signature, 'secret')
    assert not verify_webhook(body + b' ', signature, 'secret')
    assert not verify_webhook(body, signature, '')


@pytest.mark.asyncio
async def test_local_only_never_sends_provider_request(tmp_path):
    from app.v2.models import ModelGateway
    settings = config(tmp_path)
    settings.nebius_api_key = 'test-key-not-real'
    gateway = ModelGateway(settings)
    with pytest.raises(ValueError, match='consent'):
        await gateway.review('one', 'correctness', 'print(1)', ['E1'], allow_external=False)
    assert gateway.budget.summary()['calls'] == 0


def test_model_findings_require_valid_citations_and_locations():
    from app.v2.models import validate_model_output
    good = {'findings': [{'claim': 'check the boundary', 'evidence_ids': ['E1'], 'file': 'a.py', 'line': 2}]}
    assert validate_model_output(good, ['E1'], {'a.py': {2}})
    good['findings'][0]['evidence_ids'] = ['imaginary']
    with pytest.raises(ValueError, match='citation'):
        validate_model_output(good, ['E1'], {'a.py': {2}})


def test_benchmark_scores_do_not_count_abstention_as_a_negative():
    from app.v2.evaluation import score_predictions
    report = score_predictions([
        {'truth': True, 'prediction': True}, {'truth': True, 'prediction': None},
        {'truth': False, 'prediction': True}, {'truth': False, 'prediction': False},
    ])
    assert report['precision'] == 0.5
    assert report['recall'] == 0.5
    assert report['abstentions'] == 1 and report['cases'] == 4

