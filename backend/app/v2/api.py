"""V2 API: safe public fixtures and authenticated maintainer review operations."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import secrets
import time
from collections import defaultdict, deque
from typing import Literal

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.v2.evaluation import run_seeded
from app.v2.evidence import ReceiptSigner, sarif_report
from app.v2.github_app import GitHubAppPublisher, allowed_repositories, verify_webhook
from app.v2.service import ReviewService
from app.v2.store import DuplicateDelivery


class CreateReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['fixture', 'pr'] = 'fixture'
    fixture_id: str | None = Field(default=None, max_length=64)
    pull_request_url: str | None = Field(default=None, max_length=300)
    base_sha: str = Field(default='', max_length=40)
    head_sha: str = Field(default='', max_length=40)
    use_models: bool = False
    allow_external_code: bool = False


class Demo(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fixture_id: str = Field(default='py-coupon-floor', max_length=64)


class Feedback(BaseModel):
    model_config = ConfigDict(extra='forbid')
    finding_id: str = Field(max_length=100)
    state: Literal['open', 'acknowledged', 'suppressed']


class Benchmark(BaseModel):
    model_config = ConfigDict(extra='forbid')
    repeats: int = Field(default=3, ge=1, le=3)


class Publish(BaseModel):
    model_config = ConfigDict(extra='forbid')
    installation_id: str = Field(pattern=r'^\d{1,20}$')


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    service = ReviewService(settings)
    app = FastAPI(title='AegisPR V2 Evidence API', version='2.0.0',
                  docs_url='/docs' if settings.app_env != 'production' else None)
    app.state.reviews = service
    requests: dict[str, deque] = defaultdict(deque)
    benchmark_lock = asyncio.Lock()

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        path = request.url.path
        public = (path == '/health' or path in {'/api/v2/public-key', '/api/v2/verify-receipt', '/api/github/webhook'} or
                  path == '/api/v2/demo' or path.startswith('/api/v2/demo/'))
        if not public and path.startswith('/api/') and request.method != 'OPTIONS':
            token = settings.api_access_token
            if settings.app_env == 'production' and not token:
                return JSONResponse({'detail': 'Owner access is not configured'}, status_code=503)
            if token and not secrets.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + token):
                return JSONResponse({'detail': 'Enter the owner deployment access code'}, status_code=401)
        if request.method == 'POST':
            # Bound both Content-Length and chunked bodies before JSON/schema parsing.
            maximum = 1_000_000 if path in {'/api/github/webhook', '/api/v2/verify-receipt'} else 65536
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > maximum:
                    return JSONResponse({'detail': 'Request body exceeds the size limit'}, status_code=413)
            request._body = bytes(data)
            peer = request.client.host if request.client else 'unknown'
            key = peer + (':webhook' if path == '/api/github/webhook' else ':review')
            timestamp = time.monotonic()
            if len(requests) > 4096:
                requests.clear()
            bucket = requests[key]
            while bucket and timestamp - bucket[0] >= 60:
                bucket.popleft()
            if len(bucket) >= (60 if path == '/api/github/webhook' else 10):
                return JSONResponse({'detail': 'Request rate exceeded; retry in one minute'}, status_code=429)
            bucket.append(timestamp)
        response = await call_next(request)
        response.headers.update({'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                                 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'})
        return response

    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False,
                       allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type', 'Last-Event-ID'])

    def get(run_id: str, *, demo=False):
        run = service.store.get(run_id)
        if not run or (demo and not run['policy'].get('public_demo')):
            raise HTTPException(404, 'Review was not found')
        return run

    def create(payload, background, *, demo=False, delivery=None):
        try:
            run = service.create(payload, delivery=delivery)
            run['policy']['public_demo'] = demo
            service.store.save(run)
        except DuplicateDelivery:
            raise
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        background.add_task(service.execute, run['id'])
        return run

    @app.get('/health')
    async def health():
        gpu = 'not_configured'
        if settings.gpu_worker_url:
            try:
                async with httpx.AsyncClient(timeout=2, follow_redirects=False) as client:
                    response = await client.get(settings.gpu_worker_url.rstrip('/') + '/health',
                                                headers={'Authorization': 'Bearer ' + (settings.gpu_worker_token or '')})
                    if response.is_success:
                        gpu = response.json().get('accelerator', 'unknown')
                    else:
                        gpu = 'unavailable'
            except (httpx.HTTPError, ValueError):
                gpu = 'unavailable'
        return {'status': 'ok', 'version': '2.0.0', 'scope': 'curated fixtures and static PR review',
                'arbitrary_execution': False, 'gpu_accelerator': gpu,
                'executor': 'remote curated fixture worker' if settings.v2_worker_url else 'local committed fixtures',
                'providers': {'nebius': bool(settings.nebius_api_key), 'vultr': bool(settings.vultr_api_key)}}

    @app.get('/api/v2/demo')
    def fixtures():
        return [{'id': case.id, 'title': case.title, 'language': case.language, 'category': case.category}
                for case in service.cases.values()]

    @app.post('/api/v2/demo', status_code=202)
    def demo(payload: Demo, background_tasks: BackgroundTasks):
        return create({'mode': 'fixture', 'fixture_id': payload.fixture_id}, background_tasks, demo=True)

    @app.get('/api/v2/demo/{run_id}')
    def get_demo(run_id: str):
        return get(run_id, demo=True)

    @app.get('/api/v2/demo/{run_id}/receipt')
    def demo_receipt(run_id: str):
        run = get(run_id, demo=True)
        if not run.get('receipt'):
            raise HTTPException(409, 'Evidence is still being collected')
        return run['receipt']

    @app.get('/api/v2/demo/{run_id}/sarif')
    def demo_sarif(run_id: str):
        return sarif_report(get(run_id, demo=True))

    @app.post('/api/v2/demo/{run_id}/repair')
    async def demo_repair(run_id: str):
        get(run_id, demo=True)
        try:
            return await service.repair(run_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get('/api/v2/public-key')
    def public_key():
        return {'key_id': service.signer.key_id, 'public_key': service.signer.public_key,
                'algorithm': 'Ed25519', 'trust': 'Pin this key through a trusted channel before offline verification.'}

    @app.post('/api/v2/verify-receipt')
    def verify_receipt(payload: dict):
        return {'verified': ReceiptSigner.verify(payload, service.signer.public_key), 'key_id': service.signer.key_id}

    @app.get('/api/v2/config')
    def config():
        return {**service.gateway.configuration(), 'allowed_repositories': sorted(allowed_repositories(settings)),
                'github_app': {'configured': bool(settings.github_app_id and settings.github_app_private_key_path),
                               'webhook_configured': bool(settings.github_webhook_secret), 'publish_enabled': settings.github_publish_enabled},
                'executor': {'remote_configured': bool(settings.v2_worker_url), 'arbitrary_execution': False},
                'privacy': 'External model use requires explicit consent on each review. Provider keys stay on the server.'}

    @app.post('/api/v2/reviews', status_code=202)
    def review(payload: CreateReview, background_tasks: BackgroundTasks):
        return create(payload.model_dump(), background_tasks)

    @app.get('/api/v2/reviews')
    def reviews():
        return service.store.list()

    @app.get('/api/v2/reviews/{run_id}')
    def get_review(run_id: str):
        run = get(run_id)
        return {**run, 'feedback': service.store.get_feedback(run_id)}

    @app.get('/api/v2/reviews/{run_id}/receipt')
    def receipt(run_id: str):
        run = get(run_id)
        if not run['receipt']:
            raise HTTPException(409, 'Evidence is still being collected')
        return run['receipt']

    @app.get('/api/v2/reviews/{run_id}/sarif')
    def sarif(run_id: str):
        return sarif_report(get(run_id))

    @app.post('/api/v2/reviews/{run_id}/feedback')
    def feedback(run_id: str, payload: Feedback):
        get(run_id)
        try:
            return service.feedback(run_id, payload.finding_id, payload.state)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post('/api/v2/reviews/{run_id}/repair')
    async def repair(run_id: str):
        get(run_id)
        try:
            return await service.repair(run_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get('/api/v2/reviews/{run_id}/events')
    async def events(run_id: str, request: Request):
        get(run_id)
        async def stream():
            delivered = request.headers.get('Last-Event-ID')
            seen = set()
            initial = True
            for _ in range(120):
                run = get(run_id)
                entries = run['events']
                start = next((n + 1 for n, event in enumerate(entries) if event['id'] == delivered), 0) if initial else 0
                if initial:
                    seen.update(event['id'] for event in entries[:start])
                initial = False
                for event in entries[start:]:
                    if event['id'] not in seen:
                        seen.add(event['id'])
                        yield f'id: {event["id"]}\nevent: evidence\ndata: {json.dumps(event)}\n\n'
                if run['status'] not in {'QUEUED', 'RUNNING'} or await request.is_disconnected():
                    break
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type='text/event-stream')

    @app.get('/api/v2/benchmarks')
    def benchmarks():
        return service.store.benchmarks()

    @app.post('/api/v2/models/evaluate')
    async def evaluate(payload: Benchmark):
        if benchmark_lock.locked():
            raise HTTPException(409, 'A benchmark is already running')
        async with benchmark_lock:
            return await run_seeded(service, repeats=payload.repeats)

    @app.post('/api/v2/reviews/{run_id}/publish')
    async def publish(run_id: str, payload: Publish):
        try:
            return await GitHubAppPublisher(settings).publish(get(run_id), payload.installation_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(502, 'GitHub publication failed; no automatic retry') from exc

    @app.post('/api/github/webhook')
    async def webhook(request: Request, background_tasks: BackgroundTasks):
        body = await request.body()
        if not verify_webhook(body, request.headers.get('X-Hub-Signature-256', ''), settings.github_webhook_secret or ''):
            raise HTTPException(401, 'Invalid webhook signature')
        delivery = request.headers.get('X-GitHub-Delivery', '')
        if not re.fullmatch(r'[A-Za-z0-9-]{1,100}', delivery):
            raise HTTPException(422, 'Invalid delivery identifier')
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict) or any(not isinstance(payload.get(key, {}), dict) for key in ('repository', 'installation', 'pull_request')):
                raise ValueError('Invalid webhook envelope')
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(422, 'Invalid webhook payload or conflicting replay') from exc
        repo = payload.get('repository', {}).get('full_name', '')
        installation = str(payload.get('installation', {}).get('id', ''))
        if (request.headers.get('X-GitHub-Event') != 'pull_request' or
                payload.get('action') not in {'opened', 'reopened', 'synchronize'} or
                repo.lower() not in allowed_repositories(settings) or installation not in settings.github_installation_ids.split(',')):
            if not service.store.claim_delivery(delivery, hashlib.sha256(body).hexdigest()):
                return {'status': 'duplicate'}
            return {'status': 'ignored'}
        pr = payload.get('pull_request', {})
        if not all(isinstance(pr.get(key), dict) for key in ('base', 'head')):
            raise HTTPException(422, 'Invalid PR commit envelope')
        try:
            run = create({'mode': 'pr', 'pull_request_url': pr.get('html_url', ''),
                          'base_sha': pr['base'].get('sha', ''), 'head_sha': pr['head'].get('sha', '')}, background_tasks,
                         delivery=(delivery, hashlib.sha256(body).hexdigest()))
        except DuplicateDelivery:
            return {'status': 'duplicate'}
        return {'status': 'accepted', 'run_id': run['id'], 'publication': 'owner opt-in only'}

    return app


def app_factory():
    return create_app()
