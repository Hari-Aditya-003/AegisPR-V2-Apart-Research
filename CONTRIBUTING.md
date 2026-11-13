# Contributing to AegisPR V2

Read [the foundation preview scope](docs/v2-release.md), [prior work](PRIOR_WORK.md), and [security policy](SECURITY.md) before changing the executor or publishing evidence. Preserve the original source attribution and dated evidence limitations.

Use Python 3.12 or later and a Node version supported by the pinned frontend packages. Create a local virtual environment, install `backend/requirements.txt`, and run `npm ci` in `frontend`. Provider keys are not needed for unit tests or trusted local fixture evaluation.

From `backend`, run `../.venv/bin/python -m pytest`. From `frontend`, run `npm run test:coverage`, `npm run typecheck`, and `npm run e2e`. The separate `v2.playwright.config.ts` exercises a running V2 deployment and its actual safe fixture worker. Those integration tests perform no paid model calls.

Keep regression tests for incorrect proof upgrades, stale SHAs, invalid citations, malformed provider output, uncertain billing, replay, and receipt tampering. Do not lower coverage thresholds to conceal untested behavior. Changes to a fixture, model prompt, executor image, or evaluation harness require a new measurement identifier and an explicit scope note.

No test should consume credits by default. Live model checks need an explicit operator cap and the shared spending ledger. Never send private repository source to an external model without specific source-sharing consent.

For general project conventions and the inherited application, see [the original contribution guide](docs/CONTRIBUTING.md).
