# AegisPR V2 foundation preview

This release adds a versioned evidence workspace to the preserved AegisPR baseline. It implements safe fixture execution, static PR review, category-based model proposals, integrity receipts, and reproducible fixture measurements. It is a maintainer preview, not a completed V3 research release or an anonymous arbitrary-code execution service.

## What is new

- `/api/v2/reviews` accepts exact base and head SHAs for operator-allowlisted public GitHub repositories. It rejects stale SHAs and incomplete or oversized file retrieval. No repository dependencies or tests are executed by this source-review path.
- Every changed file has an analyzed or skipped record. Rule-based diagnostics use added lines; SARIF output carries stable finding fingerprints. Prior reviews of the same PR are compared for new, persisting, and resolved findings. Owner feedback is stored outside signed evidence.
- A separate curated fixture worker runs committed Python and JavaScript examples in pre-pulled, digest-pinned containers. Each revision runs three times. Guest containers have no network, mounts, provider credentials, or Docker socket. The API itself has no Docker socket. The worker does have host-equivalent Docker authority and accepts only known fixture IDs, never source, commands, or packages.
- The preserved CUDA ranker is used for bounded lexical context prioritization. Each review records the actual accelerator and the CPU fallback when applicable. This is not learned code retrieval and does not establish a quality improvement.
- Nebius and Vultr adapters share one SQLite reservation ledger. The default development cap is $1 total, $0.03 per review, and at most three calls per review. Source-sharing consent is false by default; there are no automatic paid retries. Missing or uncertain usage retains a conservative charge. This is application-side admission control, not the provider balance or a provider-enforced spending cap.
- Nemotron Lightning handles ordinary category proposals; the tests/repair task registry names Nemotron Super as a candidate. MiMo Flash on Vultr is the independent critic route. New V2 endpoints do not execute model-generated tests or repairs. The inherited V1 maintainer workflow remains separate.
- Structured model proposals must cite existing evidence IDs and changed source lines. Model output cannot change execution outcomes or create proof. Invalid responses fail closed.
- Ed25519 receipts use RFC 8785 JSON canonicalization. An offline verifier requires an independently trusted public key. A modified payload or a different trust key fails verification. Signatures establish integrity and signer identity, not correctness or kernel isolation.
- The review dashboard, category filters, proof view, manual fixture repair, coverage, model decisions, spending limits, and fixture benchmark screens use actual API records.
- GitHub webhook HMAC validation, transactional duplicate admission, exact-SHA checks, and opt-in neutral check publishing are implemented. App registration, repository installation, a reachable HTTPS webhook, and operator credentials are required before this integration can operate live. Publishing stays disabled by default.

## Safe examples and repair scope

The safe demo accepts only one of the 12 committed fixture IDs. Each invocation produces new execution evidence and records deterministic local Git commit IDs. Its tests and expected values are hand-authored. A fixture's intent label is not a model finding or an independent specification.

The repair button evaluates a prewritten manual patch restoring the fixture baseline, repeats its oracle three times, and creates a new signed evidence revision linked to the previous receipt hash. It never pushes a branch or merges code. `FIX_VERIFIED` in this preview's repair record means the selected fixture oracle passed; it does not mean a general repository's build, lint, existing tests, or security checks passed.

The historical V1 UI is retained at `/legacy`, with its original endpoints in `app.main`. The V2 deployment starts `app.v2.api` and deliberately does not expose V1's arbitrary Docker build/test workflow.

## Run the separate Dell deployment

Use a trusted Linux Docker host with the NVIDIA container runtime, Git, and Docker Compose. The worker's Docker socket is appropriate only on a trusted operator host. Do not grant guest code or anonymous API callers that authority.

1. Copy `.env.v2.example` to a private `.env.v2`, restrict it to mode 0600, and set separate random owner, worker, and GPU-worker tokens. Add provider keys only if paid routing is wanted. Set `DOCKER_GID` to the socket's group ID. Never copy the example's blank values into a live setup.
2. Pre-pull the exact Python and Node digests in `compose.v2.yaml`; the worker refuses implicit image pulls.
3. Build the three images with `docker compose --env-file .env.v2 -f compose.v2.yaml build`.
4. Initialize the worker signing key in its persistent volume using `docker compose --env-file .env.v2 -f compose.v2.yaml run --rm --no-deps fixture-worker python -c "from pathlib import Path; from app.v2.evidence import ReceiptSigner; print(ReceiptSigner(Path('/srv/worker-data/signing-key.pem')).public_key)"`. Put the returned public key in `V2_WORKER_PUBLIC_KEY`. Use a temporary nonempty bootstrap value only for this initialization command; do not start the API with it.
5. Start with `docker compose --env-file .env.v2 -f compose.v2.yaml up -d`.

The default API and UI bindings are loopback ports 8200 and 3200. For a private browser on another machine, open an SSH tunnel forwarding those ports. The frontend's default API URL is `http://localhost:8200`. An internet deployment needs its own trusted HTTPS origins, authentication policy, request limits, and public-exposure review.

The V2 compose project, images, volumes, tokens, and ports are separate from the original deployment. Stop only this preview with `docker compose --env-file .env.v2 -f compose.v2.yaml down`; do not add `--volumes` unless evidence and signing-key destruction is intended.

## Verify a receipt offline

Download the receipt JSON and obtain the deployment's Ed25519 public key through a trusted channel. From the backend environment:

```bash
python -m app.v2.evidence receipt.json --public-key TRUSTED_BASE64_PUBLIC_KEY
```

The verifier exits zero only for a valid signature against that key. The public key included in a downloaded bundle is not automatically a trust anchor. Initial development receipts without the `canonicalization` field retain their legacy Python JSON serialization for offline verification; new receipts use RFC 8785 and survive browser number serialization.

## Reproduce fixture measurements

The authenticated benchmark screen executes the 12 pinned fixtures with three repetitions per fixture. Each repetition includes three base and three head executions. Raw outcomes, per-category denominators, abstentions, dataset digest, exact fixture SHAs, and links to individual signed runs are retained.

For a local trusted-fixture measurement without model calls:

```bash
cd backend
python -m app.v2.evaluation --repeats 3 --output ../artifacts/fixture-benchmark.json
```

These measurements test orchestration against fixture-authored oracles. They are not independent review accuracy, real-PR coverage, model comparison, repair generalization, or a ReviewBench score. `validate_external_manifest` checks pinned external PR manifests but does not download or execute those repositories.

### Recorded checks

The November 13 Dell run produced 36 signed reviews from 12 committed fixtures. Each review ran three base and three head checks in the pinned worker images, for 216 executions. The harness detected 24 seeded regressions, recorded three unchanged results, and abstained on nine intentional changes. It used zero model calls. The [fixture summary](../evals/results/2026-11-13-dell-fixture-summary.json) also preserves the earlier JavaScript harness false negative and identifies the corrected harness by digest.

The [ReviewBench intake check](../evals/results/2026-11-13-reviewbench-intake.json) used five small cases from the pinned public test manifest. Four passed exact-commit ingestion and static coverage, and one was skipped after its PR commits diverged from the manifest. This was a read-only compatibility check without runtime execution, model calls, or official ReviewBench scoring.

The two live provider checks returned schema-valid responses from Nemotron Lightning and MiMo Flash. One preceding Nebius response exhausted its output allowance before producing valid JSON. All three calls accounted for $0.000288 against the $1 development cap.

## Roadmap acceptance status

| Roadmap area | Current result | Remaining acceptance work |
| --- | --- | --- |
| A-01 independent untrusted install and test | Curated remote worker; no dependency installation; API socket removed | Independent ephemeral VM boundary, restricted dependency proxy, adversarial containment and teardown tests before arbitrary execution |
| A-02 signed evidence | Implemented, tested offline and through API/browser | Operational key rotation, independent key distribution, release signing |
| A-03 benchmark harness | 12 pinned synthetic pairs, repeated raw fixture measurements; external lock validation | A licensed external ReviewBench subset and independent labels, model outputs and repeated comparisons |
| A-04 GitHub App | Signed webhook, transactional deduplication, pinned reads, neutral check publisher | Actual app registration and owner installation, reachable HTTPS webhook, live delivery/check tests |
| A-05 safe demonstration | New evidence on each curated fixture run; private Dell preview | Public judge URL and clean-browser public-access acceptance |
| B-01 coverage and bundling | All retrieved changed files accounted for; path grouping and lexical GPU prioritization | Full import/AST dependency neighborhoods, related-file acquisition, measured retrieval benefit |
| B-02 scanners | Bounded diff rule packs and SARIF normalization/export | Automatic isolated Semgrep/linter execution and scanner-specific fixtures |
| B-03 incremental review | Stable fingerprints and new/persisting/resolved comparison | Reappeared-finding lifecycle and live GitHub comment deduplication |
| B-04 specialists | Typed category task registry, provider routing, budget/consent/citation validation | Category-specific measured prompts and independent specialist quality evaluation |
| B-05 flaky outcomes | Three stable checks required for the fixture regression classification | General generated-test flakiness and test minimization evaluation |
| C-01 two model families | Nebius Nemotron and Vultr MiMo adapters; bounded live smoke calls | Equivalent-task quality evaluation; smoke calls are connectivity/schema evidence only |
| C-02 independent critic | Distinct family/provider, advisory-only results | Controlled ablations demonstrating benefit |
| C-03 generated tests | Inherited V1 implementation retained | Safe execution and evaluation of newly generated V2 tests |
| C-04 verified repair | Explicit manual fixture repair; no write back | Independent execution of model patches and full required non-regression/build/lint/security checks |
| C-05 model comparison | Fixture/category dashboard with raw outcomes | Real comparative model runs and ablations |
| D-01 telemetry | Not implemented | Trusted host-side capture, unique canaries, observed/proven semantics and containment tests |
| D-02 ecosystem | Existing CLI retained; V2 HTTP API and SARIF | MCP server, GitLab adapter, new CI integration |
| D-03 privacy and BYOK | Environment-held keys, per-review source consent, model-free profile | Organization identities, scoped keys, multi-tenant policy and retention controls |
| D-04 advanced benchmarks | Existing scoped GPU/performance/API checks retained | Separate independent GPU, SQL, API and performance datasets and measurements |
| D-05 research release | Provenance, methods, negatives and raw fixture records | External baselines, dataset permissions, confidence intervals, ablations and threats-to-validity study |

Do not describe the complete V2–V3 roadmap as finished or this preview as a public-ready arbitrary executor. These are engineering and evidence gates, not branding changes.
