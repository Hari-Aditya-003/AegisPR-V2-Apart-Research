"""Evidence DAG integrating ingestion, coverage, specialists, execution and receipts."""
from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import httpx

from app.evaluation.seeded_dataset import load_cases, materialize_cases
from app.github.parser import parse_pull_request_url
from app.services.context_ranker import ContextDocument, ContextRanker
from app.v2.analysis import analyze_patch, finding, reconcile_findings
from app.v2.evidence import ReceiptSigner, adjudicate
from app.v2.execution import FixtureExecutor, RemoteFixtureExecutor
from app.v2.github_app import SHA, allowed_repositories, pinned_pull_request
from app.v2.models import ModelGateway
from app.v2.store import ReviewStore


def now():
    return datetime.now(timezone.utc).isoformat()


class ReviewService:
    def __init__(self, settings):
        self.settings = settings
        self.store = ReviewStore(settings.data_path.with_name('v2-reviews.sqlite3'))
        self.signer = ReceiptSigner(settings.v2_signing_key_path)
        self.gateway = ModelGateway(settings)
        self.ranker = ContextRanker(settings.gpu_worker_url, settings.gpu_worker_token)
        self.dataset_path = Path(__file__).resolve().parents[3] / 'evals/seeded-prs/cases.json'
        self.cases = {case.id: case for case in load_cases(self.dataset_path)}
        self.dataset_digest = hashlib.sha256(self.dataset_path.read_bytes()).hexdigest()
        self.fixture_repositories = settings.data_path.parent / 'v2-fixtures'
        self.executor = (RemoteFixtureExecutor(settings, self.dataset_digest) if settings.v2_worker_url else FixtureExecutor())
        self._repair_locks: dict[str, asyncio.Lock] = {}

    def create(self, payload: dict, *, benchmark=False, delivery=None):
        mode = payload.get('mode', 'fixture')
        if mode not in {'fixture', 'pr'}:
            raise ValueError('Unsupported review mode')
        if mode == 'fixture':
            if payload.get('fixture_id') not in self.cases:
                raise ValueError('Choose a committed safe fixture')
        else:
            ref = parse_pull_request_url(payload.get('pull_request_url', ''))
            if f'{ref.owner}/{ref.repository}'.lower() not in allowed_repositories(self.settings):
                raise ValueError('Repository is not in the operator allowlist')
            if not all(SHA.fullmatch(payload.get(key, '')) for key in ('base_sha', 'head_sha')):
                raise ValueError('Exact base and head SHAs are required')
        if payload.get('use_models') and not payload.get('allow_external_code'):
            raise ValueError('Explicit external code consent is required')
        run = {'id': str(uuid4()), 'schema': 'aegispr.review.v2', 'mode': mode,
               'fixture_id': payload.get('fixture_id'), 'pull_request_url': payload.get('pull_request_url'),
               'base_sha': payload.get('base_sha', ''), 'head_sha': payload.get('head_sha', ''),
               'title': self.cases[payload['fixture_id']].title if mode == 'fixture' else 'Pinned pull request review',
               'status': 'QUEUED', 'created_at': now(), 'completed_at': None, 'duration_ms': 0,
               'policy': {'version': 'aegispr-v2.0', 'use_models': bool(payload.get('use_models')),
                          'allow_external_code': bool(payload.get('allow_external_code')),
                          'repair_opt_in': False, 'arbitrary_execution': False},
               'coverage': [], 'findings': [], 'events': [], 'executions': [], 'model_invocations': [],
               'incremental': None, 'repair': None, 'receipt': None, 'cost': self.gateway.budget.summary('unused'),
               'limitations': ['Only evidence produced in this run is assessed; no claim of defect-free software.',
                               'Arbitrary repository installation and execution are disabled in V2 safe mode.']}
        if mode == 'fixture':
            run['limitations'].append('Controlled synthetic fixture with prewritten checks and manual repair; not an AI or real-PR benchmark.')
        if benchmark:
            self.store.save(run)
        else:
            self.store.admit(run, daily_limit=self.settings.v2_daily_reviews, delivery=delivery)
        return run

    def event(self, run, stage: str, detail: str, *, data=None):
        run['events'].append({'id': f'E-{len(run["events"]) + 1:04}', 'stage': stage, 'detail': detail,
                              'timestamp': now(), 'data': data or {}})
        self.store.save(run)

    def fixture_metadata(self, case):
        if not self.fixture_repositories.exists():
            self.fixture_repositories.parent.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(dir=self.fixture_repositories.parent) as temporary:
                target = Path(temporary) / 'pairs'
                materialize_cases(list(self.cases.values()), target)
                try:
                    target.rename(self.fixture_repositories)
                except FileExistsError:
                    pass
        index = json.loads((self.fixture_repositories / 'index.json').read_text())
        return next(item for item in index['cases'] if item['id'] == case.id)

    async def execute_fixture(self, case, *, repair=False):
        if isinstance(self.executor, RemoteFixtureExecutor):
            return await self.executor.execute(case, repair=repair)
        return await asyncio.to_thread(self.executor.execute, case, repair=repair)

    async def execute(self, run_id: str):
        run = self.store.get(run_id)
        if not run or run['status'] != 'QUEUED':
            return
        started = time.monotonic()
        run['status'] = 'RUNNING'
        self.event(run, 'ingestion', 'Pinning inputs and applying repository policy')
        try:
            if run['mode'] == 'fixture':
                case = self.cases[run['fixture_id']]
                metadata = await asyncio.to_thread(self.fixture_metadata, case)
                run['base_sha'], run['head_sha'] = metadata['base_commit'], metadata['head_commit']
                filename = 'target.py' if case.language == 'python' else 'target.js'
                files = [{'filename': filename, 'status': 'modified', 'patch': ''.join(difflib.unified_diff(
                    case.base_source.splitlines(True), case.head_source.splitlines(True), fromfile='a/' + filename, tofile='b/' + filename))}]
            else:
                pr = await pinned_pull_request(self.settings, run['pull_request_url'], run['base_sha'], run['head_sha'])
                run['title'], files = pr['title'], pr['files']
            run['coverage'], run['findings'] = analyze_patch(files)
            ranking = await self.ranker.rank(run['title'], [
                ContextDocument(path=item['filename'], content=item.get('patch', '')[:12000], changed=True)
                for item in files if item.get('patch')
            ], limit=20)
            run['context_accelerator'] = ranking.accelerator
            run['context_order'] = [document.path for document in ranking.documents]
            self.event(run, 'context', f'Context ranked with {ranking.accelerator}; lexical vectors, not learned code embeddings')
            for coverage, file in zip(run['coverage'], files):
                run['events'].append({'id': coverage['evidence_id'], 'stage': 'coverage', 'detail': coverage['file'],
                                      'timestamp': now(), 'data': {'patch': file.get('patch', '')}})
            self.event(run, 'static', 'Changed files accounted for; source observations do not establish runtime proof')
            await self.specialists(run, files)
            if run['mode'] == 'fixture':
                self.event(run, 'execution', 'Executing curated base and head checks three times each; no dependency installation')
                run['executions'] = await self.execute_fixture(case)
                base = [r['status'] for r in run['executions'] if r['branch'] == 'base']
                head = [r['status'] for r in run['executions'] if r['branch'] == 'head']
                run['status'] = adjudicate(base, head, valid_contract=case.intent != 'intended', trusted_executor=True)
                if run['status'] not in {'VERIFIED_WITHIN_SCOPE', 'ENVIRONMENT_ERROR', 'INCONCLUSIVE'}:
                    item = finding('fixture.oracle', 'correctness', 'medium',
                                   'The head differs from the prewritten baseline contract on the selected fixture inputs.',
                                   filename, 1, ['E-execution'])
                    item.update({'status': run['status'], 'provenance': 'Curated fixture oracle; no model',
                                 'limitations': ['Fixture intent label is hand-authored, not inferred from an independent specification.']})
                    run['findings'].append(item)
                self.event(run, 'E-execution', 'Repeated execution evidence collected', data={'count': len(run['executions'])})
                run['events'][-1]['id'] = 'E-execution'
            else:
                run['status'] = 'ANALYSIS_ONLY'
                run['limitations'].append('No untrusted install/test was executed; candidate findings are not confirmed regressions.')
            previous = next((old for old in self.store.list(100) if old['id'] != run_id and
                             old.get('pull_request_url') and old.get('pull_request_url') == run.get('pull_request_url') and
                             old['status'] not in {'RUNNING', 'QUEUED'}), None)
            if previous:
                run['incremental'] = {'previous_run': previous['id'], **reconcile_findings(run['findings'], previous['findings'])}
            self.event(run, 'adjudication', 'Classified deterministic evidence; model votes cannot upgrade proof')
        except (ValueError, OSError, httpx.HTTPError, KeyError) as exc:
            run['status'] = 'ENVIRONMENT_ERROR'
            # Provider/OS exceptions can contain URLs, headers, or sensitive paths.
            self.event(run, 'error', 'Review could not complete under the configured policy; no defect conclusion was made')
            logging.getLogger(__name__).warning('V2 run %s failed with %s', run_id, type(exc).__name__)
        run['duration_ms'] = int((time.monotonic() - started) * 1000)
        run['completed_at'] = now()
        run['cost'] = self.gateway.budget.summary(run_id)
        self.seal(run)

    async def specialists(self, run, files):
        if not run['policy']['use_models']:
            self.event(run, 'models', 'Local-only review selected; zero model requests')
            return
        changed = {row['file']: set(row['added_lines']) for row in run['coverage'] if row['state'] == 'analyzed'}
        evidence_ids = [row['evidence_id'] for row in run['coverage']]
        priority = {path: index for index, path in enumerate(run.get('context_order', []))}
        ordered = sorted(files, key=lambda item: priority.get(item['filename'], 1000))
        context = json.dumps({'title': run['title'], 'files': ordered}, separators=(',', ':'))
        categories = list(dict.fromkeys(row['category'] for row in run['coverage'] if row['state'] == 'analyzed'))
        tasks = (categories or ['triage'])[:2] + ['critic']
        for task in tasks:
            try:
                invocation = await self.gateway.review(run['id'], task, context, evidence_ids,
                                                       allow_external=run['policy']['allow_external_code'], changed=changed)
                run['model_invocations'].append(invocation)
                if task != 'critic':
                    for item in invocation['output']['findings']:
                        proposal = finding('model.' + task, task, 'medium', item['claim'], item['file'], item['line'], item['evidence_ids'])
                        proposal.update({'status': 'CANDIDATE', 'provenance': invocation['provider'] + '/' + invocation['model']})
                        run['findings'].append(proposal)
                else:
                    # Critic receives original cited material and proposals; it cannot change execution states.
                    invocation['advisory_only'] = True
                context = json.dumps({'source': context[:12000], 'proposals': run['findings']})[:16000]
            except ValueError as exc:
                run['model_invocations'].append({'task': task, 'status': 'blocked', 'reason': str(exc)[:300]})
        self.event(run, 'models', 'Specialist proposals validated against existing evidence IDs and changed source lines')

    def seal(self, run):
        payload = {key: value for key, value in run.items() if key != 'receipt'}
        # Serialize before attaching a receipt so later mutations cannot change its signed payload.
        run['receipt'] = self.signer.sign(json.loads(json.dumps(payload, allow_nan=False)))
        self.store.save(run)

    async def repair(self, run_id: str):
        lock = self._repair_locks.setdefault(run_id, asyncio.Lock())
        async with lock:
            run = self.store.get(run_id)
            if not run:
                raise KeyError(run_id)
            if run['mode'] != 'fixture' or run['status'] != 'REGRESSION_FOUND':
                raise ValueError('Safe repair is available only for a reproduced curated regression; arbitrary write-back is disabled')
            if run.get('repair'):
                return run
            case = self.cases[run['fixture_id']]
            checks = await self.execute_fixture(case, repair=True)
            passed = len(checks) == 3 and all(item['status'] == 'pass' for item in checks)
            run['repair'] = {'status': 'FIX_VERIFIED' if passed else 'FAILED', 'write_back': False,
                             'provenance': 'Prewritten manual fixture repair; not AI-generated; no repository write',
                             'checks': checks, 'previous_receipt_sha256': run['receipt']['sha256'],
                             'patch': ''.join(difflib.unified_diff(case.head_source.splitlines(True), case.base_source.splitlines(True),
                                                                 fromfile='a/target.py' if case.language == 'python' else 'a/target.js',
                                                                 tofile='b/target.py' if case.language == 'python' else 'b/target.js'))}
            self.event(run, 'repair', 'Opt-in manual fixture patch evaluated three times; no write-back')
            self.seal(run)
            return run

    def feedback(self, run_id: str, finding_id: str, state: str):
        run = self.store.get(run_id)
        if not run:
            raise KeyError(run_id)
        if state not in {'open', 'acknowledged', 'suppressed'} or finding_id not in {item['id'] for item in run['findings']}:
            raise ValueError('Unknown finding or feedback state')
        self.store.feedback(run_id, finding_id, state)
        return self.store.get_feedback(run_id)
