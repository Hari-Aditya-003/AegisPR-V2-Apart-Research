import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), start: vi.fn(), list: vi.fn(), config: vi.fn(), fixtures: vi.fn(), health: vi.fn(), create: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));
vi.mock('../lib/v2-api', () => ({
  listReviews: mocks.list, getModelConfig: mocks.config, listFixtures: mocks.fixtures, getV2Health: mocks.health,
  startSafeDemo: mocks.start, createReview: mocks.create,
}));
import { ReviewDashboard } from '../components/v2-workspace';
import Page from '../app/page';

beforeEach(() => {
  mocks.list.mockResolvedValue([]);
  mocks.config.mockResolvedValue({ budget: { accounted_cost_usd: 0, limit_usd: 1, per_run_usd: .03, calls: 0 }, routes: [], enabled: false });
  mocks.fixtures.mockResolvedValue([{ id: 'py-coupon-floor', title: 'Coupon floor', language: 'python' }]);
  mocks.health.mockResolvedValue({ gpu_accelerator: 'cpu', executor: 'local committed fixtures' });
  mocks.start.mockResolvedValue({ id: 'new-proof' });
});

describe('V2 review workspace', () => {
  it('shows honest empty data and starts a new zero-cost safe execution', async () => {
    render(<ReviewDashboard />);
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /run safe example/i }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('py-coupon-floor'));
    expect(mocks.push).toHaveBeenCalledWith('/reviews/new-proof');
  });

  it('shows execution errors without inventing results', async () => {
    mocks.start.mockRejectedValueOnce(new Error('Worker unavailable'));
    render(<ReviewDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /run safe example/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Worker unavailable');
    expect(screen.getByRole('button', { name: /run safe example/i })).toBeEnabled();
  });

  it('requires explicit source consent before enabling a paid specialist review', async () => {
    render(<ReviewDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /review a pull request/i }));
    expect(screen.getByLabelText(/base commit sha/i)).toBeRequired();
    expect(screen.getByLabelText(/head commit sha/i)).toBeRequired();
    fireEvent.click(screen.getByLabelText(/use paid specialists/i));
    expect(screen.getByLabelText(/send this public source/i)).toBeRequired();
  });

  it('submits exact pinned commits and explicit consent to the review API', async () => {
    mocks.create.mockResolvedValue({ id: 'pinned' });
    render(<Page />);
    await screen.findByText('No reviews yet');
    fireEvent.click(screen.getByRole('button', { name: /review a pull request/i }));
    fireEvent.change(screen.getByLabelText(/github pull request url/i), { target: { value: 'https://github.com/acme/repo/pull/1' } });
    fireEvent.change(screen.getByLabelText(/base commit sha/i), { target: { value: 'a'.repeat(40) } });
    fireEvent.change(screen.getByLabelText(/head commit sha/i), { target: { value: 'b'.repeat(40) } });
    fireEvent.click(screen.getByLabelText(/use paid specialists/i));
    fireEvent.click(screen.getByLabelText(/send this public source/i));
    fireEvent.click(screen.getByRole('button', { name: /start pinned review/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), allow_external_code: true })));
    expect(mocks.push).toHaveBeenCalledWith('/reviews/pinned');
  });

  it('renders stored review evidence and permits a fixture selection', async () => {
    mocks.list.mockResolvedValue([{ id: 'old', title: 'Stored proof', status: 'REGRESSION_FOUND', mode: 'fixture', head_sha: 'b'.repeat(40), findings: [], cost: { accounted_cost_usd: .001 } }]);
    render(<ReviewDashboard />);
    expect(await screen.findByRole('link', { name: /stored proof/i })).toHaveAttribute('href', '/reviews/old');
    fireEvent.change(screen.getByLabelText(/choose a fixture/i), { target: { value: 'py-coupon-floor' } });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  });
});
