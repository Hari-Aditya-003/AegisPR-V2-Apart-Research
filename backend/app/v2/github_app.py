"""GitHub App identity, pinned read-only ingestion, and opt-in check publishing."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from urllib.parse import quote

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from app.github.parser import parse_pull_request_url
from app.v2.analysis import safe_path


SHA = re.compile(r'^[0-9a-f]{40}$')


def verify_webhook(body: bytes, signature: str, secret: str) -> bool:
    return bool(secret) and hmac.compare_digest('sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), signature)


def allowed_repositories(settings) -> set[str]:
    return {part.strip().lower() for part in settings.v2_allowed_repositories.split(',') if part.strip()}


async def pinned_pull_request(settings, url: str, base_sha: str, head_sha: str) -> dict:
    ref = parse_pull_request_url(url)
    repo = f'{ref.owner}/{ref.repository}'
    if repo.lower() not in allowed_repositories(settings):
        raise ValueError('Repository is not in the operator allowlist')
    if not SHA.fullmatch(base_sha) or not SHA.fullmatch(head_sha) or base_sha == head_sha:
        raise ValueError('Distinct exact base and head commit SHAs are required')
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if settings.github_token:
        headers['Authorization'] = f'Bearer {settings.github_token}'
    async with httpx.AsyncClient(base_url='https://api.github.com', headers=headers, timeout=20,
                                 follow_redirects=False) as client:
        async def get(path, params=None):
            async with client.stream('GET', path, params=params) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 2_000_000:
                        raise ValueError('GitHub response exceeds the review size limit')
            return json.loads(data)

        pr = await get(f'/repos/{repo}/pulls/{ref.number}')
        if pr['base']['repo'].get('private'):
            raise ValueError('V2 currently accepts allowlisted public repositories only')
        if pr['base']['sha'] != base_sha or pr['head']['sha'] != head_sha:
            raise ValueError('PR commits changed; reload and submit the exact current SHAs')
        if pr.get('changed_files', 0) > settings.max_changed_files:
            raise ValueError('PR exceeds the configured file limit; no incomplete review will be presented as complete')
        files = await get(f'/repos/{repo}/pulls/{ref.number}/files', {'per_page': 100})
        if len(files) != pr.get('changed_files'):
            raise ValueError('GitHub file coverage is incomplete')
        if sum(len(f.get('patch', '')) for f in files) > settings.max_diff_characters:
            raise ValueError('PR exceeds the configured diff budget')
        # Check again after file retrieval to detect a concurrent PR push.
        after = await get(f'/repos/{repo}/pulls/{ref.number}')
        if after['base']['sha'] != base_sha or after['head']['sha'] != head_sha:
            raise ValueError('PR changed during ingestion; stale review rejected')
        return {'title': pr['title'][:300], 'repository': repo, 'number': ref.number,
                'base_sha': base_sha, 'head_sha': head_sha, 'files': files, 'pull_request_url': url}


class GitHubAppPublisher:
    def __init__(self, settings):
        self.settings = settings

    def jwt(self) -> str:
        if not self.settings.github_app_id or not self.settings.github_app_private_key_path:
            raise ValueError('GitHub App credentials are not configured')
        encode = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=')
        now = int(time.time())
        header = encode(b'{"alg":"RS256","typ":"JWT"}')
        payload = encode(json.dumps({'iat': now - 60, 'exp': now + 540, 'iss': self.settings.github_app_id}).encode())
        message = header + b'.' + payload
        key = serialization.load_pem_private_key(self.settings.github_app_private_key_path.read_bytes(), password=None)
        signature = key.sign(message, padding.PKCS1v15(), hashes.SHA256())
        return (message + b'.' + encode(signature)).decode()

    async def publish(self, run: dict, installation: str) -> dict:
        if not self.settings.github_publish_enabled:
            raise ValueError('GitHub publication is disabled; owner opt-in is required')
        if installation not in self.settings.github_installation_ids.split(','):
            raise ValueError('Installation is not authorized')
        ref = parse_pull_request_url(run['pull_request_url'])
        repo = f'{ref.owner}/{ref.repository}'
        if repo.lower() not in allowed_repositories(self.settings) or not SHA.fullmatch(run['head_sha']):
            raise ValueError('Publication target is not authorized')
        if run['status'] in {'QUEUED', 'RUNNING'}:
            raise ValueError('Review has not completed')
        async with httpx.AsyncClient(base_url='https://api.github.com', timeout=20, follow_redirects=False) as client:
            response = await client.post(f'/app/installations/{int(installation)}/access_tokens',
                                         headers={'Authorization': f'Bearer {self.jwt()}', 'Accept': 'application/vnd.github+json'},
                                         json={'repositories': [ref.repository], 'permissions': {'checks': 'write', 'contents': 'read', 'pull_requests': 'read'}})
            response.raise_for_status()
            headers = {'Authorization': f'Bearer {response.json()["token"]}', 'Accept': 'application/vnd.github+json'}
            current = await client.get(f'/repos/{repo}/pulls/{ref.number}', headers=headers)
            current.raise_for_status()
            if current.json()['head']['sha'] != run['head_sha']:
                raise ValueError('PR head changed; refusing a stale check')
            # Neutral is deliberate: this app does not enable a required merge gate.
            response = await client.post(f'/repos/{repo}/check-runs', headers=headers, json={
                'name': 'AegisPR evidence', 'head_sha': run['head_sha'], 'status': 'completed', 'conclusion': 'neutral',
                'external_id': run['id'], 'output': {'title': run['status'],
                'summary': f'{len(run["findings"])} scoped findings. Receipt SHA256: {run["receipt"]["sha256"]}. Human review required.'}})
            response.raise_for_status()
            return {'id': response.json()['id'], 'url': response.json()['html_url'], 'head_sha': run['head_sha']}
