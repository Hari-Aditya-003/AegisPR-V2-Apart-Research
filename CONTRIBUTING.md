# Contributing to AegisPR V2

Read [the foundation preview scope](docs/v2-release.md), [prior work](PRIOR_WORK.md), and [security policy](SECURITY.md) before changing the executor or publishing evidence. Preserve the original source attribution and dated evidence limitations.

## Pick a task

Browse [good first issues](https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) for a small change or [help wanted](https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) for a larger task. Check the issue's assignee, comments, and linked pull requests. A short comment describing what you plan to work on helps others avoid duplicating it. For a new idea, [search existing issues](https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/issues) and describe the user-facing result you want. Follow the [code of conduct](CODE_OF_CONDUCT.md) and report security concerns privately as described in [SECURITY.md](SECURITY.md).

## Get a first check running

Fork this V2 repository on GitHub, clone your fork, and create a branch from its current `main`. Run the following from the repository root. With Node.js 22 installed, you can check the static website immediately:

```sh
make test-website
```

For the backend, use Python 3.12 to match CI. The Makefile looks for pytest in `backend/.venv`.

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
make test-backend
```

For the Next.js workspace, run the following with Node.js 22 and npm:

```sh
cd frontend
npm ci
npm run test:coverage
npm run typecheck
```

| If you are changing | Start here | Additional check |
| --- | --- | --- |
| V2 review or scoring behavior | [V2 backend](backend/app/v2), [backend tests](backend/tests) | From `backend`, run a focused test with `.venv/bin/python -m pytest --no-cov tests/test_v2_evidence.py`. Use `make test-backend` from the root for the full coverage check. |
| A page or control | [Pages](frontend/app), [components](frontend/components), [browser tests](frontend/e2e) | From `frontend`, install Chromium with `npx playwright install chromium` and run `npm run e2e`. On Linux CI, the install also uses `--with-deps`. |
| The static website | [Site files](website/dist), [website tests](website/tests) | Run `make test-website` from the root. |
| Fixtures or measurements | [Dataset guide](evals/seeded-prs/README.md), [release scope](docs/v2-release.md) | Follow the dataset guide to validate the committed fixtures and record the measurement scope. |

The unit tests use local data or mocks. The separate [V2 integration suite](frontend/v2.playwright.config.ts) needs a running V2 deployment and fixture worker. See [the CI workflow](.github/workflows/ci.yml) for the full Linux checks.

## Open a pull request

Push your branch to your fork and open a pull request against `main` in **Hari-Aditya-003/AegisPR-V2-Apart-Research**. Link the issue (use `Closes #123` when the PR completes it), describe the change, and list the commands you ran and their results. For a visible UI change, include a screenshot or a short description of what you checked. If a check needs a deployment or hardware you couldn't access, say which check is outstanding.

Reviewers can use the issue's acceptance criteria to check the change. Record new V2 contributions and their evidence as described in [PRIOR_WORK.md](PRIOR_WORK.md). The project uses the [MIT license](LICENSE).

## Evidence and credit use

Keep regression tests for incorrect proof upgrades, stale SHAs, invalid citations, malformed provider output, uncertain billing, replay, and receipt tampering. Do not lower coverage thresholds to conceal untested behavior. Changes to a fixture, model prompt, executor image, or evaluation harness require a new measurement identifier and an explicit scope note.

No test should consume credits by default. Live model checks need an explicit operator cap and the shared spending ledger. Never send private repository source to an external model without specific source-sharing consent.

For general project conventions and the inherited application, see [the original contribution guide](docs/CONTRIBUTING.md).
