"""Deterministic adjudication and offline-verifiable Ed25519 evidence bundles."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

import rfc8785

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def canonical(value: dict) -> bytes:
    return rfc8785.dumps(value)


class ReceiptSigner:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            key = Ed25519PrivateKey.generate()
            data = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption())
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError('Signing key must be a private, non-symlink file with mode 0600')
        self._key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(self._key, Ed25519PrivateKey):
            raise ValueError('Expected an Ed25519 signing key')
        self.public_key = base64.b64encode(self._key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        self.key_id = hashlib.sha256(base64.b64decode(self.public_key)).hexdigest()[:16]

    def sign(self, payload: dict) -> dict:
        protected = {'schema': 'aegispr.evidence.v2', 'canonicalization': 'RFC8785', 'key_id': self.key_id, 'payload': payload}
        data = canonical(protected)
        return {**protected, 'sha256': hashlib.sha256(data).hexdigest(),
                'signature': base64.b64encode(self._key.sign(data)).decode(), 'public_key': self.public_key,
                'notice': 'Signature establishes bundle integrity and signer identity, not correctness or isolation.'}

    @staticmethod
    def verify(bundle: dict, trusted_public_key: str) -> bool:
        try:
            raw = base64.b64decode(trusted_public_key, validate=True)
            if bundle['public_key'] != trusted_public_key or bundle['schema'] != 'aegispr.evidence.v2':
                return False
            if bundle['key_id'] != hashlib.sha256(raw).hexdigest()[:16]:
                return False
            protected = {key: bundle[key] for key in ('schema', 'key_id', 'payload')}
            if 'canonicalization' in bundle:
                if bundle['canonicalization'] != 'RFC8785':
                    return False
                protected['canonicalization'] = bundle['canonicalization']
                data = canonical(protected)
            else:
                # Retain offline verification of receipts produced during the initial development checks.
                data = json.dumps(protected, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
            if hashlib.sha256(data).hexdigest() != bundle['sha256']:
                return False
            Ed25519PublicKey.from_public_bytes(raw).verify(base64.b64decode(bundle['signature'], validate=True), data)
            return True
        except (KeyError, TypeError, ValueError, InvalidSignature):
            return False


def adjudicate(base: list[str], head: list[str], *, valid_contract: bool, trusted_executor: bool) -> str:
    if not trusted_executor or min(len(base), len(head)) < 3 or len(base) != len(head):
        return 'INCONCLUSIVE'
    if any(item in {'error', 'timeout', 'skipped'} for item in base + head):
        return 'ENVIRONMENT_ERROR'
    if len(set(base)) != 1 or len(set(head)) != 1:
        return 'INCONCLUSIVE'
    if base[0] not in {'pass', 'fail'} or head[0] not in {'pass', 'fail'}:
        return 'INCONCLUSIVE'
    if base[0] == 'pass' and head[0] == 'fail':
        return 'REGRESSION_FOUND' if valid_contract else 'BEHAVIOR_CHANGE_INTENT_UNKNOWN'
    if base[0] == head[0] == 'fail':
        return 'PRE_EXISTING_FAILURE'
    if base[0] == head[0] == 'pass':
        return 'VERIFIED_WITHIN_SCOPE'
    return 'BEHAVIOR_CHANGE_INTENT_UNKNOWN'


def sarif_report(run: dict) -> dict:
    results = []
    rules = {}
    for finding in run['findings']:
        if not finding.get('file') or not finding.get('line'):
            continue
        rule = finding.get('rule_id', 'aegispr.' + finding['category'])
        rules[rule] = {'id': rule, 'shortDescription': {'text': finding['category']}}
        results.append({'ruleId': rule, 'level': {'high': 'error', 'medium': 'warning'}.get(finding['severity'], 'note'),
                        'message': {'text': finding['claim']},
                        'partialFingerprints': {'aegispr/v2': finding['fingerprint']},
                        'locations': [{'physicalLocation': {'artifactLocation': {'uri': finding['file']},
                                                           'region': {'startLine': finding['line']}}}],
                        'properties': {'status': finding['status'], 'evidence_ids': finding['evidence_ids']}})
    return {'version': '2.1.0', '$schema': 'https://json.schemastore.org/sarif-2.1.0.json',
            'runs': [{'tool': {'driver': {'name': 'AegisPR', 'version': '2.0.0', 'rules': list(rules.values())}},
                      'results': results, 'properties': {'run_id': run['id'], 'head_sha': run['head_sha']}}]}


def main():
    parser = argparse.ArgumentParser(description='Verify an AegisPR receipt against an independently trusted public key')
    parser.add_argument('receipt', type=Path)
    parser.add_argument('--public-key', required=True, help='Base64 Ed25519 public key obtained through a trusted channel')
    args = parser.parse_args()
    verified = ReceiptSigner.verify(json.loads(args.receipt.read_text()), args.public_key)
    print(json.dumps({'verified': verified}))
    raise SystemExit(0 if verified else 1)


if __name__ == '__main__':
    main()
