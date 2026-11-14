"""Bounded diff coverage, rule packs, and reviewdog-style diagnostic filtering.

These are candidate observations. A source match never establishes a runtime defect.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import PurePosixPath


SOURCE_SUFFIXES = {'.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.rs', '.java', '.kt', '.cs', '.c', '.cpp', '.h', '.sql'}
CATEGORIES = ('correctness', 'security', 'performance', 'api', 'dependency', 'gpu', 'sql')
RULES = [
    ('security.eval', 'security', 'high', r'\b(?:eval|exec)\s*\(', 'Dynamic code execution needs a validated trust boundary.'),
    ('security.shell', 'security', 'high', r'shell\s*=\s*True', 'Shell execution may interpret untrusted arguments; inspect the data flow.'),
    ('security.tls', 'security', 'high', r'verify\s*=\s*False|rejectUnauthorized\s*:\s*false', 'TLS certificate verification is disabled.'),
    ('security.sql', 'security', 'medium', r'(?:execute|query)\s*\(\s*f[\'\"]', 'Interpolated SQL requires a parameterization review.'),
    ('performance.loop', 'performance', 'low', r'\b(?:sleep|setTimeout)\s*\(', 'Timing changes need repeated measurements before claiming a regression.'),
    ('dependency.install', 'dependency', 'medium', r'"(?:preinstall|postinstall|prepare)"\s*:', 'Package lifecycle code can run during installation.'),
    ('correctness.assert', 'correctness', 'low', r'\bassert\s+', 'Check that this assertion reflects a valid requirement on both revisions.'),
]


def safe_path(path: str) -> bool:
    parsed = PurePosixPath(path)
    return bool(path) and not parsed.is_absolute() and '..' not in parsed.parts and '\\' not in path and not any(ord(c) < 32 for c in path)


def added_lines(patch: str) -> dict[int, str]:
    result = {}
    current = None
    for line in patch.splitlines():
        if line.startswith('@@'):
            match = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', line)
            current = int(match[1]) if match else None
        elif current is not None:
            if line.startswith('+'):
                result[current] = line[1:]
                current += 1
            elif line.startswith(' '):
                current += 1
    return result


def finding(rule: str, category: str, severity: str, claim: str, path: str, line: int, evidence_ids=None) -> dict:
    # Match on rule/path/normalized claim, not line number, to survive nearby edits.
    fingerprint = hashlib.sha256(f'{rule}:{path}:{claim}'.encode()).hexdigest()
    return {'id': 'F-' + fingerprint[:12], 'fingerprint': fingerprint, 'rule_id': rule, 'category': category,
            'severity': severity, 'claim': claim[:2000], 'file': path, 'line': line,
            'status': 'SECURITY_OBSERVATION' if category in {'security', 'dependency'} else 'CANDIDATE',
            'evidence_ids': evidence_ids or [], 'provenance': 'deterministic diff rule; data flow not proven'}


def analyze_patch(files: list[dict]) -> tuple[list[dict], list[dict]]:
    coverage, findings = [], []
    for index, file in enumerate(files):
        path = file['filename']
        evidence_id = f'E-diff-{index + 1}'
        suffix = PurePosixPath(path).suffix.lower()
        is_manifest = PurePosixPath(path).name in {'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod'}
        reason = None
        if not safe_path(path):
            reason = 'Unsafe source path'
        elif file.get('status') == 'removed':
            reason = 'Removed file; no head-side lines to review'
        elif suffix not in SOURCE_SUFFIXES and not is_manifest:
            reason = 'No rule pack for this asset or document type'
        elif not file.get('patch'):
            reason = 'Patch unavailable or truncated by GitHub; coverage is incomplete'
        lines = added_lines(file.get('patch', ''))
        category = 'dependency' if is_manifest else 'sql' if suffix == '.sql' else 'gpu' if suffix == '.cu' else 'correctness'
        lower = path.lower()
        if any(word in lower for word in ('auth', 'secret', 'permission', 'security')):
            category = 'security'
        coverage.append({'file': path, 'state': 'skipped' if reason else 'analyzed', 'reason': reason,
                         'category': category, 'added_lines': list(lines), 'evidence_id': evidence_id,
                         'bundle': str(PurePosixPath(path).parent), 'rules': 'aegispr-diff-v2'})
        if reason:
            continue
        for number, text in lines.items():
            for rule, kind, severity, pattern, claim in RULES:
                if re.search(pattern, text):
                    findings.append(finding(rule, kind, severity, claim, path, number, [evidence_id]))
    return coverage, list({(f['fingerprint'], f['line']): f for f in findings}.values())


def normalize_sarif(payload: dict, changed: dict[str, set[int]]) -> list[dict]:
    findings = {}
    for run in payload.get('runs', [])[:10]:
        for result in run.get('results', [])[:5000]:
            for location in result.get('locations', [])[:1]:
                physical = location.get('physicalLocation', {})
                path = physical.get('artifactLocation', {}).get('uri', '')
                line = physical.get('region', {}).get('startLine')
                if not safe_path(path) or type(line) is not int or line not in changed.get(path, set()):
                    continue
                rule = str(result.get('ruleId', 'external.scanner'))[:120]
                message = result.get('message', {}).get('text', 'External diagnostic')
                item = finding(rule, 'security', 'high' if result.get('level') == 'error' else 'medium', str(message), path, line)
                item['provenance'] = 'external SARIF diagnostic; changed-line filtered; not execution proof'
                findings[(item['fingerprint'], line)] = item
    return list(findings.values())


def reconcile_findings(current: list[dict], previous: list[dict]) -> dict:
    old = {f['fingerprint']: f for f in previous}
    new = {f['fingerprint']: f for f in current}
    return {'new': [f['id'] for key, f in new.items() if key not in old],
            'persisting': [f['id'] for key, f in new.items() if key in old],
            'resolved': [f['id'] for key, f in old.items() if key not in new]}
