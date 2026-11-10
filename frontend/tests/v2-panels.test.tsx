import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn(), repair: vi.fn(), verify: vi.fn(), feedback: vi.fn(), config: vi.fn(), benchmarks: vi.fn(), benchmark: vi.fn(), download: vi.fn(), sarif: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/reviews/one' }));
vi.mock('../lib/v2-api', () => ({ getReview: mock.get, repairReview: mock.repair, verifyReceipt: mock.verify, saveFeedback: mock.feedback,
  getModelConfig: mock.config, listBenchmarks: mock.benchmarks, runBenchmark: mock.benchmark, downloadJson: mock.download, getSarif: mock.sarif }));
import { ReviewDetail, ModelsPanel, BenchmarksPanel } from '../components/v2-panels';
const run = { id: 'one', title: 'Coupon proof', mode: 'fixture', status: 'REGRESSION_FOUND', base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40),
  policy: { public_demo: true, use_models: false }, cost: { accounted_cost_usd: 0, calls: 0, input_tokens: 0, output_tokens: 0, cache_hits: 0 },
  findings: [{ id: 'F1', category: 'correctness', severity: 'medium', claim: 'Negative total', file: 'target.py', line: 2, status: 'REGRESSION_FOUND', evidence_ids: ['E1'], provenance: 'Prewritten oracle' }],
  events: [{ id: 'E1', stage: 'execution', detail: 'Executed', data: {} }], coverage: [{ file: 'target.py', state: 'analyzed', added_lines: [2] }],
  executions: [{ branch: 'base', repeat: 1, status: 'pass', observations: [0], exit_code: 0, stdout: '0', stderr: '', executor: 'local trusted fixture' }],
  model_invocations: [], receipt: { key_id: 'test-key', sha256: 'hash', payload: {} }, repair: null, limitations: ['Controlled fixture'], duration_ms: 123, incremental: null };
beforeEach(() => { mock.get.mockResolvedValue(structuredClone(run)); mock.verify.mockResolvedValue({ verified: true }); mock.benchmarks.mockResolvedValue([]); });
it('links findings to proof and verifies the receipt', async () => {
  render(<ReviewDetail id="one" />);
  expect(await screen.findByText('Negative total')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Proof' }));
  expect(screen.getByText('Exact commits')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /verify receipt/i }));
  expect(await screen.findByText(/signature valid/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /download receipt/i }));
  expect(mock.download).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Coverage' }));
  expect(screen.getByText('target.py')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Models' }));
  expect(screen.getByText(/no model calls/i)).toBeInTheDocument();
});
it('requests repair only after an explicit action and shows no-write-back provenance', async () => {
  mock.repair.mockResolvedValue({ ...run, repair: { status: 'FIX_VERIFIED', patch: '+fixed', provenance: 'Prewritten manual repair', checks: [], write_back: false } });
  render(<ReviewDetail id="one" />);
  await screen.findByText('Negative total');
  fireEvent.click(screen.getByRole('tab', { name: 'Repair' }));
  expect(mock.repair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /verify fixture repair/i }));
  expect(await screen.findByText('Prewritten manual repair')).toBeInTheDocument();
});
it('surfaces loading failures', async () => {
  mock.get.mockRejectedValue(new Error('Owner code required'));
  render(<ReviewDetail id="one" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Owner code required');
});
it('does not fabricate benchmarks before evaluation', async () => {
  render(<BenchmarksPanel />);
  expect(await screen.findByText('No measured runs yet')).toBeInTheDocument();
  expect(screen.getByText(/synthetic fixtures/i)).toBeInTheDocument();
});
it('shows model spending and operator-controlled routing without exposing credentials', async () => {
  mock.config.mockResolvedValue({ enabled: true, routes: [{ task: 'critic', model_id: 'mimo-v2.6-flash', provider: 'vultr', family: 'mimo', configured: true, input_per_million: '.1', output_per_million: '.25', reason: 'Different family', price_checked: '2026-11-10', price_source: 'https://api.vultrinference.com' }],
    budget: { accounted_cost_usd: .001, limit_usd: 1, per_run_usd: .03, calls: 2, max_calls: 3 }, allowed_repositories: ['owner/repo'], github_app: { configured: false, webhook_configured: false, publish_enabled: false }, executor: { remote_configured: false }, privacy: 'Consent required' });
  render(<ModelsPanel />);
  expect(await screen.findByText('mimo-v2.6-flash')).toBeInTheDocument();
  expect(screen.getByText('$1.00')).toBeInTheDocument();
  expect(screen.getByText('Consent required')).toBeInTheDocument();
});
