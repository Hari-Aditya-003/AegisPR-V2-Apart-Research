"""Separate fixed-fixture worker. Never mount a Docker socket in the V2 API."""
import asyncio
import hashlib
import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.evaluation.seeded_dataset import load_cases
from app.v2.evidence import ReceiptSigner
from app.v2.execution import FixtureExecutor


app = FastAPI(title='AegisPR curated fixture worker', docs_url=None)
dataset = Path(__file__).resolve().parents[3] / 'evals/seeded-prs/cases.json'
cases = {case.id: case for case in load_cases(dataset)}
lock = asyncio.Semaphore(1)


class Work(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fixture_id: str = Field(max_length=64)
    nonce: str = Field(pattern=r'^[0-9a-f]{32}$')
    repair: bool = False


@app.get('/health')
def health():
    return {'status': 'ok', 'scope': 'curated-fixtures-only', 'arbitrary_repository_execution': False,
            'image_pinned': '@sha256:' in os.environ.get('V2_FIXTURE_IMAGE', '')}


@app.post('/execute')
async def execute(work: Work, request: Request):
    token = os.environ.get('V2_WORKER_TOKEN', '')
    if not token or not secrets.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + token):
        raise HTTPException(401, 'Worker authentication required')
    if work.fixture_id not in cases:
        raise HTTPException(422, 'Unknown committed fixture')
    image = os.environ.get('V2_FIXTURE_IMAGE' if cases[work.fixture_id].language == 'python' else 'V2_NODE_FIXTURE_IMAGE')
    if not image:
        raise HTTPException(503, 'Pinned fixture image is not configured')
    async with lock:
        executions = await asyncio.to_thread(FixtureExecutor(docker_image=image).execute, cases[work.fixture_id], repair=work.repair)
    signer = ReceiptSigner(Path(os.environ.get('V2_WORKER_SIGNING_KEY', 'data/worker-key.pem')))
    return signer.sign({'nonce': work.nonce, 'fixture_id': work.fixture_id, 'repair': work.repair,
                        'dataset_sha256': hashlib.sha256(dataset.read_bytes()).hexdigest(), 'executions': executions})
