export type Coverage = { file: string; state: string; reason: string | null; category: string; added_lines: number[]; evidence_id: string; bundle: string };
export type V2Finding = { id: string; fingerprint: string; category: string; severity: string; claim: string; file: string; line: number; status: string; evidence_ids: string[]; provenance: string };
export type Execution = { branch: string; repeat: number; status: string; exit_code: number | null; observations: unknown[]; stdout: string; stderr: string; duration_ms: number; executor: string; environment_digest: string; network: string; provenance: string };
export type Cost = { accounted_cost_usd: number; calls: number; input_tokens: number; output_tokens: number; cache_hits: number };
export type EvidenceEvent = { id: string; stage: string; detail: string; timestamp: string; data: Record<string, unknown> };
export type Receipt = { schema: string; key_id: string; sha256: string; signature: string; public_key: string; payload: Record<string, unknown>; notice: string };
export type Invocation = { task: string; provider?: string; model?: string; reason: string; status?: string; latency_ms?: number; cache_hit?: boolean; advisory_only?: boolean; output?: { findings: { claim: string; evidence_ids: string[]; file: string; line: number }[] } };
export type Review = {
  id: string; mode: string; fixture_id: string | null; pull_request_url: string | null; title: string;
  status: string; base_sha: string; head_sha: string; created_at: string; completed_at: string | null; duration_ms: number;
  policy: { use_models: boolean; allow_external_code: boolean; public_demo?: boolean; arbitrary_execution: boolean };
  coverage: Coverage[]; findings: V2Finding[]; events: EvidenceEvent[]; executions: Execution[];
  model_invocations: Invocation[]; cost: Cost; limitations: string[]; receipt: Receipt | null;
  repair: null | { status: string; patch: string; write_back: boolean; provenance: string; checks: Execution[]; previous_receipt_sha256: string };
  feedback?: Record<string, string>; incremental: null | { previous_run: string; new: string[]; persisting: string[]; resolved: string[] };
};
export type Fixture = { id: string; title: string; language: string; category: string };
export type ModelConfig = {
  enabled: boolean; external_code_default: boolean; privacy: string;
  budget: Cost & { limit_usd: number; per_run_usd: number; max_calls: number; note: string };
  routes: { task: string; provider: string; family: string; configured: boolean; model_id: string; reason: string; input_per_million: string; output_per_million: string; price_source: string; price_checked: string }[];
  allowed_repositories: string[]; github_app: { configured: boolean; webhook_configured: boolean; publish_enabled: boolean };
  executor: { remote_configured: boolean; arbitrary_execution: boolean };
};
export type Metrics = { cases: number; precision: number | null; recall: number | null; f1: number | null; abstentions: number; false_positives: number; true_positives: number };
export type BenchmarkReport = { id: string; dataset: string; dataset_sha256: string; profile: string; repeats: number; unique_cases: number; metrics: Metrics; categories: Record<string, Metrics>; median_duration_ms: number; cost_usd: number; limitations: string[]; raw: { fixture: string; repeat: number; run_id: string; status: string }[] };
export type V2Health = { gpu_accelerator: string; executor: string; providers: { nebius: boolean; vultr: boolean } };
