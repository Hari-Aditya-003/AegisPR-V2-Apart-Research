"""Pinned fixture evaluation and explicit abstention-aware scoring."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
from collections import defaultdict
from pathlib import Path
from uuid import uuid4


def score_predictions(rows: list[dict]) -> dict:
    tp = sum(r['truth'] is True and r['prediction'] is True for r in rows)
    fp = sum(r['truth'] is False and r['prediction'] is True for r in rows)
    positive = sum(r['truth'] is True for r in rows)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / positive if positive else None
    return {'cases': len(rows), 'true_positives': tp, 'false_positives': fp,
            'false_negatives_including_abstentions': positive - tp,
            'abstentions': sum(r['prediction'] is None for r in rows), 'precision': precision, 'recall': recall,
            'f1': 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else None}


async def run_seeded(service, *, repeats: int = 3) -> dict:
    if not 1 <= repeats <= 3:
        raise ValueError('Benchmark repeats must be between one and three')
    rows, grouped, timings = [], defaultdict(list), []
    # Deliberately use only the curated, committed fixtures; no downloaded code is executed.
    for case in service.cases.values():
        for repeat in range(repeats):
            run = service.create({'mode': 'fixture', 'fixture_id': case.id}, benchmark=True)
            await service.execute(run['id'])
            run = service.store.get(run['id'])
            prediction = (True if run['status'] == 'REGRESSION_FOUND' else
                          False if run['status'] == 'VERIFIED_WITHIN_SCOPE' else None)
            row = {'fixture': case.id, 'repeat': repeat + 1, 'run_id': run['id'], 'category': case.category,
                   'base_sha': run['base_sha'], 'head_sha': run['head_sha'],
                   'truth': case.intent == 'unintended', 'prediction': prediction, 'status': run['status']}
            rows.append(row)
            grouped[case.category].append(row)
            timings.append(run['duration_ms'])
    report = {'id': str(uuid4()), 'dataset': 'aegispr-seeded-prs-v1',
              'dataset_sha256': hashlib.sha256(service.dataset_path.read_bytes()).hexdigest(),
              'harness_sha256': hashlib.sha256(b''.join((Path(__file__).parent / name).read_bytes()
                  for name in ('evaluation.py', 'execution.py', 'service.py', 'evidence.py', 'models.py', 'analysis.py'))).hexdigest(),
              'profile': 'deterministic execution with fixture-authored oracle; no model',
              'repeats': repeats, 'unique_cases': len(service.cases), 'metrics': score_predictions(rows),
              'categories': {key: score_predictions(value) for key, value in grouped.items()},
              'median_duration_ms': statistics.median(timings), 'cost_usd': 0, 'raw': rows,
              'limitations': ['Synthetic fixtures and hand-authored oracles; not independent review-quality measurements.',
                             'No model comparison or external ReviewBench score is claimed.']}
    service.store.save_benchmark(report)
    return report


def validate_external_manifest(path: Path) -> dict:
    """Validate a ReviewBench-compatible lock file without cloning or running repositories."""
    document = json.loads(path.read_text())
    cases = document.get('cases', [])
    if not document.get('source') or not cases or len(cases) > 1000:
        raise ValueError('A source URL and bounded case list are required')
    import re
    for case in cases:
        if not all(re.fullmatch(r'[0-9a-f]{40}', case.get(key, '')) for key in ('base_sha', 'head_sha')):
            raise ValueError('Every external PR must pin exact base and head SHAs')
        if case.get('label') not in {'regression', 'no_regression', 'unknown'}:
            raise ValueError('Explicit external labels are required')
    return {'cases': len(cases), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'executed': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    from app.config import Settings
    from app.v2.service import ReviewService
    report = asyncio.run(run_seeded(ReviewService(Settings()), repeats=args.repeats))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('id', 'unique_cases', 'repeats', 'metrics', 'cost_usd')}))


if __name__ == '__main__':
    main()
