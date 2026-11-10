import { apiUrl, requestHeaders } from './api';
import type { BenchmarkReport, Fixture, ModelConfig, Receipt, Review, V2Health } from './v2-types';

export async function v2Request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: requestHeaders(body !== undefined), cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Owner access is required. Save the deployment access code above, then retry.');
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Request could not complete (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const listReviews = () => v2Request<Review[]>('/api/v2/reviews');
export const listFixtures = () => v2Request<Fixture[]>('/api/v2/demo');
export const getV2Health = () => v2Request<V2Health>('/health');
export const getModelConfig = () => v2Request<ModelConfig>('/api/v2/config');
export const startSafeDemo = (fixture_id: string) => v2Request<Review>('/api/v2/demo', { fixture_id });
export const createReview = (payload: Record<string, unknown>) => v2Request<Review>('/api/v2/reviews', payload);
export async function getReview(id: string): Promise<Review> {
  // Public access is limited to explicitly public fixture runs. Private runs need owner authentication.
  const response = await fetch(`${apiUrl}/api/v2/demo/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (response.ok) return response.json() as Promise<Review>;
  if (response.status !== 404) throw new Error('Review service could not be reached. Retry when it is available.');
  return v2Request<Review>(`/api/v2/reviews/${encodeURIComponent(id)}`);
}
export const repairReview = (run: Review) => v2Request<Review>(`/api/v2/${run.policy.public_demo ? 'demo' : 'reviews'}/${encodeURIComponent(run.id)}/repair`, {});
export const saveFeedback = (id: string, finding_id: string, state: string) => v2Request<Record<string, string>>(`/api/v2/reviews/${encodeURIComponent(id)}/feedback`, { finding_id, state });
export const verifyReceipt = (receipt: Receipt) => v2Request<{ verified: boolean; key_id: string }>('/api/v2/verify-receipt', receipt);
export const getSarif = (id: string) => v2Request<Record<string, unknown>>(`/api/v2/reviews/${encodeURIComponent(id)}/sarif`);
export const listBenchmarks = () => v2Request<BenchmarkReport[]>('/api/v2/benchmarks');
export const runBenchmark = () => v2Request<BenchmarkReport>('/api/v2/models/evaluate', { repeats: 3 });

export function downloadJson(value: unknown, filename: string) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
