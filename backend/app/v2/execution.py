"""Execution of curated fixtures only; no user-supplied commands or dependencies.

The remote worker runs fixed fixtures in a pre-pulled, digest-pinned container
without network, mounts, provider keys, or package installation. This is not an
arbitrary repository executor or a claim of microVM isolation.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import httpx

from app.v2.evidence import ReceiptSigner


def probe_code(case, source: str) -> str:
    if case.language == 'node':
        return (source + '\nconst outputs=[];\n' +
                f'for(const args of {json.dumps(case.arguments)}) {{\n' +
                "try { outputs.push(await evaluate(...args)); } catch(e) { outputs.push('ERROR:'+e.constructor.name); }\n}\n" +
                "console.log(JSON.stringify({observations:outputs}));\n" +
                f'process.exit(JSON.stringify(outputs)===JSON.stringify({json.dumps(case.expected_base)})?0:1);\n')
    return ('import json\n' + source + '\n' +
            'outputs=[]\n' +
            f'for args in {case.arguments!r}:\n' +
            '    try: value=evaluate(*args)\n' +
            "    except Exception as exc: value='ERROR:'+type(exc).__name__\n" +
            '    outputs.append(value)\n' +
            "print(json.dumps({'observations':outputs},sort_keys=True))\n" +
            f'raise SystemExit(0 if outputs == {case.expected_base!r} else 1)\n')


class FixtureExecutor:
    """Local development runner for trusted, committed Python fixtures only."""
    def __init__(self, *, docker_image: str | None = None):
        if docker_image and not __import__('re').fullmatch(r'[a-z0-9./_-]+@sha256:[0-9a-f]{64}', docker_image):
            raise ValueError('Worker image must be pinned by sha256 digest')
        self.docker_image = docker_image
        self.docker = shutil.which('docker') if docker_image else None
        if docker_image and not self.docker:
            raise ValueError('Docker CLI is not installed on the fixture worker')

    def execute(self, case, *, repair=False) -> list[dict]:
        if case.language not in {'python', 'node'}:
            raise ValueError('Unsupported fixture language')
        results = []
        for branch, source in ([('repair', case.base_source)] if repair else [('base', case.base_source), ('head', case.head_source)]):
            code = probe_code(case, source)
            for repetition in range(3):
                started = time.monotonic()
                container = 'aegispr-v2-' + uuid4().hex
                with TemporaryDirectory(prefix='aegispr-v2-fixture-') as temporary:
                    environment = {'PATH': os.defpath, 'HOME': temporary, 'LANG': 'C', 'TZ': 'UTC'}
                    if self.docker_image:
                        command = [self.docker, 'run', '--pull=never', '--rm', '--name', container, '--network=none',
                                   '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534',
                                   '--pids-limit=32', '--memory=128m', '--cpus=0.5', '--ulimit=nofile=64:64',
                                   '--tmpfs=/tmp:rw,noexec,nosuid,size=8m', '--log-driver=none', '-i',
                                   self.docker_image, *(['python', '-I', '-B', '-'] if case.language == 'python' else
                                                       ['node', '--input-type=module', '-'])]
                    else:
                        command = ([sys.executable, '-I', '-B', '-'] if case.language == 'python' else
                                   [shutil.which('node') or '/usr/bin/node', '--input-type=module', '-'])
                    try:
                        result = subprocess.run(command, input=code, cwd=temporary, env=environment,
                                                capture_output=True, text=True, timeout=10)
                        if len(result.stdout) + len(result.stderr) > 16000:
                            raise ValueError('Fixture output limit exceeded')
                        observations = json.loads(result.stdout)['observations']
                        status = 'pass' if result.returncode == 0 else 'fail' if result.returncode == 1 else 'error'
                        item = {'branch': branch, 'repeat': repetition + 1, 'status': status, 'exit_code': result.returncode,
                                'observations': observations, 'stdout': result.stdout, 'stderr': result.stderr,
                                'test_sha256': hashlib.sha256(code.encode()).hexdigest()}
                    except (subprocess.TimeoutExpired, OSError, ValueError, KeyError):
                        item = {'branch': branch, 'repeat': repetition + 1, 'status': 'error', 'exit_code': None,
                                'observations': [], 'stdout': '', 'stderr': 'Fixture executor could not complete'}
                    finally:
                        if self.docker_image:
                            subprocess.run([self.docker, 'rm', '-f', container], capture_output=True, timeout=10, check=False)
                item.update({'duration_ms': int((time.monotonic() - started) * 1000),
                             'executor': 'remote-pinned-container' if self.docker_image else 'local-trusted-fixture',
                             'environment_digest': self.docker_image or 'local-python-' + sys.version.split()[0],
                             'network': 'none' if self.docker_image else 'not isolated; committed fixture only',
                             'provenance': 'Prewritten fixture oracle, not a model-generated test'})
                results.append(item)
        return results


class RemoteFixtureExecutor:
    def __init__(self, settings, dataset_digest: str):
        self.settings, self.dataset_digest = settings, dataset_digest

    async def execute(self, case, *, repair=False):
        if not self.settings.v2_worker_public_key or not self.settings.v2_worker_token:
            raise ValueError('Remote worker trust key and access token are required')
        nonce = uuid4().hex
        async with httpx.AsyncClient(timeout=90, follow_redirects=False) as client:
            response = await client.post(self.settings.v2_worker_url.rstrip('/') + '/execute',
                                         headers={'Authorization': 'Bearer ' + self.settings.v2_worker_token},
                                         json={'fixture_id': case.id, 'nonce': nonce, 'repair': repair})
            response.raise_for_status()
            if len(response.content) > 128000:
                raise ValueError('Worker response exceeds the evidence budget')
            receipt = response.json()
        if not ReceiptSigner.verify(receipt, self.settings.v2_worker_public_key):
            raise ValueError('Worker evidence signature does not match the trusted key')
        payload = receipt['payload']
        if (payload.get('nonce') != nonce or payload.get('fixture_id') != case.id or payload.get('repair') != repair
                or payload.get('dataset_sha256') != self.dataset_digest):
            raise ValueError('Worker evidence is stale or for a different input')
        executions = payload['executions']
        expected = [('repair', n) for n in range(1, 4)] if repair else [(branch, n) for branch in ('base', 'head') for n in range(1, 4)]
        if [(e.get('branch'), e.get('repeat')) for e in executions] != expected:
            raise ValueError('Worker evidence is missing required repeated executions')
        return executions
