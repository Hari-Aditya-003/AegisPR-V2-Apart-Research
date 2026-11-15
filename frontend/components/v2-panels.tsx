"use client";

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { accessChangedEvent } from '@/lib/api';
import { downloadJson, getBenchmarkJob, getModelConfig, getPublicReference, getReview, getSarif, listBenchmarks, repairReview, saveFeedback, startBenchmarkJob, verifyReceipt } from '@/lib/v2-api';
import type { BenchmarkJob, BenchmarkReport, Execution, ModelConfig, PublicReference, Review } from '@/lib/v2-types';
import { RuntimePanel } from './runtime-panel';
import { label, money, Status, Workspace } from './v2-workspace';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The request could not complete.';

function Executions({ items }: { items: Execution[] }) {
  return <div className="v2-executions">{items.map((item, index) => <details key={`${item.branch}-${item.repeat}-${index}`}><summary><span className={`v2-check ${item.status}`}>{item.status === 'pass' ? '✓' : '×'}</span><strong>{item.branch}</strong><span>Repeat {item.repeat}</span><code>exit {item.exit_code ?? '—'}</code><span>{item.duration_ms ?? 0} ms</span></summary>
    <p>{item.executor} · {item.network}</p><pre>{JSON.stringify(item.observations, null, 2)}</pre><pre>{item.stdout || item.stderr || 'No additional output.'}</pre><small>{item.provenance}</small></details>)}</div>;
}

export function ReviewDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Findings');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState('');
  const load = useCallback(async () => { try { setRun(await getReview(id)); setError(''); } catch (cause) { setError(errorText(cause)); } }, [id]);
  useEffect(() => { void load(); window.addEventListener(accessChangedEvent, load); return () => window.removeEventListener(accessChangedEvent, load); }, [load]);
  useEffect(() => {
    if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return;
    const timer = setTimeout(() => void load(), 1200); return () => clearTimeout(timer);
  }, [run, load]);
  async function repair() { if (!run) return; setBusy(true); setError(''); try { setRun(await repairReview(run)); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  async function verify() {
    if (!run?.receipt) return;
    setBusy(true); try { const result = await verifyReceipt(run.receipt); setSignature(result.verified ? 'Signature valid · verified against this deployment’s trusted key' : 'Signature invalid · bundle was modified or the key does not match'); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function feedback(findingId: string, state: string) {
    if (!run) return;
    try { setRun({ ...run, feedback: await saveFeedback(id, findingId, state) }); } catch (cause) { setError(errorText(cause)); }
  }
  async function sarif() { try { downloadJson(await getSarif(id, Boolean(run?.policy.public_demo)), `aegispr-${id}.sarif`); } catch (cause) { setError(errorText(cause)); } }
  return <Workspace><Link className="v2-back" href="/#workspace">← All reviews</Link>
    {error && <p className="v2-error" role="alert">{error}<button className="v2-text-button" onClick={() => void load()}>Retry</button></p>}
    {!run ? <p className="v2-empty">Loading evidence…</p> : <><div className="v2-page-heading"><div><p className="v2-overline">{run.mode === 'fixture' ? 'CONTROLLED FIXTURE / NEW EXECUTION' : 'PINNED PULL REQUEST'}</p><h1>{run.title}</h1><p>Review <code>{id.slice(0, 8)}</code> · {run.duration_ms} ms · {money(run.cost.accounted_cost_usd)} model cost</p></div><Status value={run.status} /></div>
      <div className="v2-scope"><strong>{run.mode === 'fixture' ? 'Controlled evidence' : 'Source review only'}</strong><span>{run.mode === 'fixture' ? 'Prewritten fixture checks. Each run executes again; no model-generated test or repair is implied.' : 'No untrusted dependency installation or test execution. Source findings remain candidates.'}</span></div>
      <div className="v2-review-grid"><div><div className="v2-tabs" role="tablist" aria-label="Review evidence">{['Findings', 'Proof', 'Repair', 'Coverage', 'Models'].map(name => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{name}{name === 'Findings' && <span>{run.findings.length}</span>}</button>)}</div>
        <section className="v2-panel v2-detail-panel" role="tabpanel" aria-label={tab}>
          {tab === 'Findings' && <><div className="v2-panel-heading"><h2>Evidence-linked findings</h2><button className="v2-text-button" onClick={() => void sarif()}>Export SARIF ↗</button></div>
            <div className="v2-filters">{['all', 'correctness', 'security', 'performance', 'api', 'dependency', 'gpu', 'sql'].map(kind => <button key={kind} aria-pressed={category === kind} onClick={() => setCategory(kind)}>{kind === 'all' ? 'All' : kind}</button>)}</div>
            {run.findings.filter(item => category === 'all' || item.category === category).length === 0 && <p className="v2-empty">No findings in this category. This does not establish that the change is defect-free.</p>}
            {run.findings.filter(item => category === 'all' || item.category === category).map(item => <article className="v2-finding" key={item.id}><div><span className="v2-overline">{item.category} / {item.severity}</span><Status value={item.status} /></div><h3>{item.claim}</h3><code>{item.file}:{item.line}</code><p>{item.provenance}</p>
              <div className="v2-evidence-links">{item.evidence_ids.map(ref => <button key={ref} onClick={() => setTab('Proof')}>{ref} ↗</button>)}</div>
              {!run.policy.public_demo && <div className="v2-feedback"><span>{run.feedback?.[item.id] ?? 'open'}</span><button onClick={() => void feedback(item.id, 'acknowledged')}>Acknowledge</button><button onClick={() => void feedback(item.id, 'suppressed')}>Suppress</button></div>}</article>)}
            {run.incremental && <p className="v2-footnote">Since the previous review: {run.incremental.new.length} new, {run.incremental.persisting.length} persisting, {run.incremental.resolved.length} resolved findings.</p>}</>}
          {tab === 'Proof' && <><h2>Exact commits</h2><div className="v2-commits"><div><span>BASE</span><code>{run.base_sha || 'Collecting'}</code></div><div><span>HEAD</span><code>{run.head_sha || 'Collecting'}</code></div></div>
            <div className="v2-panel-heading"><h2>Repeated execution</h2><span className="v2-badge">{run.executions.length} receipts</span></div>{run.executions.length ? <Executions items={run.executions} /> : <p className="v2-empty">No runtime proof was produced in this review.</p>}
            <div className="v2-receipt"><h2>Signed evidence bundle</h2>{run.receipt ? <><p>Ed25519 key <code>{run.receipt.key_id}</code></p><code className="v2-long-hash">SHA256 {run.receipt.sha256}</code><div className="v2-actions"><button className="v2-button secondary" disabled={busy} onClick={() => void verify()}>Verify receipt</button><button className="v2-text-button" onClick={() => downloadJson(run.receipt, `aegispr-${id}-receipt.json`)}>Download receipt ↓</button></div>{signature && <p role="status" className="v2-verification">{signature}</p>}<p className="v2-footnote">A signature verifies integrity and signer identity. It does not independently establish correctness or isolation. Pin the public key before offline verification.</p></> : <p>Evidence collection is still in progress.</p>}</div></>}
          {tab === 'Repair' && <><h2>Repair with explicit approval</h2><p>A patch stays separate from your repository. There is no automatic push or merge.</p>{run.repair ? <><Status value={run.repair.status} /><p>{run.repair.provenance}</p><pre className="v2-code">{run.repair.patch}</pre><Executions items={run.repair.checks} /><p className="v2-footnote">Repository write back: disabled.</p></> : run.mode === 'fixture' && run.status === 'REGRESSION_FOUND' ? <><p>This safe example uses a prewritten manual repair and reruns its fixture oracle three times. It is not an AI repair or a full project build.</p><button disabled={busy} className="v2-button" onClick={() => void repair()}>{busy ? 'Checking repair…' : 'Verify fixture repair'}</button></> : <p className="v2-empty">No verified repair is available. General model-generated repairs remain in the isolated maintainer workflow; free-form execution is disabled here.</p>}</>}
          {tab === 'Coverage' && <><h2>Every changed file accounted for</h2><p>Skipped files keep an explicit reason. A source scan does not imply runtime coverage.</p><div className="v2-table-wrap"><table><thead><tr><th>File</th><th>Coverage</th><th>Reason</th></tr></thead><tbody>{run.coverage.map(item => <tr key={item.file}><td><code>{item.file}</code></td><td>{item.state}</td><td>{item.reason ?? `${item.added_lines.length} added lines · ${item.category ?? 'correctness'}`}</td></tr>)}</tbody></table></div></>}
          {tab === 'Models' && <><h2>Specialist decisions</h2><p>{run.cost.calls} calls · {run.cost.input_tokens} input tokens · {run.cost.output_tokens} output tokens · {run.cost.cache_hits} cache hits</p>{run.model_invocations.length ? run.model_invocations.map((invocation, index) => <article className="v2-route" key={index}><div><strong>{invocation.task}</strong><span>{invocation.model ?? invocation.status}</span></div><p>{invocation.reason}</p>{invocation.output?.findings.map((item, n) => <p key={n}>{item.claim}</p>)}</article>) : <p className="v2-empty">No model calls. This review used deterministic tools and fixture execution only.</p>}</>}
        </section></div><aside><RuntimePanel run={run} /><section className="v2-panel v2-timeline"><p className="v2-overline">EVIDENCE TRAIL</p><h2>What actually ran</h2><ol>{run.events.map(event => <li key={event.id}><span className="v2-status-dot" /><div><strong>{event.stage}</strong><p>{event.detail}</p><code>{event.id}</code></div></li>)}</ol></section><section className="v2-limitations"><h3>Scope & limitations</h3>{run.limitations.map(note => <p key={note}>{note}</p>)}</section></aside></div>
    </>}
  </Workspace>;
}

function usePublicReference() {
  const [reference, setReference] = useState<PublicReference | null>(null);
  const [referenceError, setReferenceError] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await getPublicReference();
        if (active) setReference(value);
      } catch {
        if (active) setReferenceError(true);
      }
    })();
    return () => { active = false; };
  }, []);
  return { reference, referenceError };
}

export function ModelsPanel() {
  const { reference, referenceError } = usePublicReference();
  const [config, setConfig] = useState<ModelConfig | null>(null), [error, setError] = useState('');
  const load = useCallback(async () => { try { setConfig(await getModelConfig()); setError(''); } catch (cause) { setConfig(null); setError(errorText(cause)); } }, []);
  useEffect(() => { void load(); window.addEventListener(accessChangedEvent, load); return () => window.removeEventListener(accessChangedEvent, load); }, [load]);
  return <Workspace><div className="v2-page-heading"><div><p className="v2-overline">OPERATOR SETTINGS</p><h1>Models & limits</h1><p>See which models handle each task, how the app accounts for usage, and where to grant consent.</p></div><button className="v2-text-button" onClick={() => void load()}>Refresh ↻</button></div>
    <section className="v2-panel v2-help-panel">
      <h2>Choose model use on a PR review</h2>
      <ol><li>Expand <strong>Private deployment access</strong> above and save the owner code.</li>
        <li>Open <Link href="/#workspace">Reviews</Link>, select <strong>Review a pull request</strong>, and fill in the URL and both exact SHAs.</li>
        <li>Leave <strong>Use paid specialists</strong> clear for a local-only review. To opt in, check it and the separate consent to send public source.</li>
        <li>Open <strong>Models</strong> in the resulting review to inspect provider decisions, tokens, and cache hits.</li></ol>
      <p>Operators set provider credentials and budgets on the server. This page displays the effective policy after owner access.</p>
      <Link className="v2-text-button" href="/guide#model-settings">See illustrated model setup ↗</Link>
    </section>
    {!config && reference && <section className="v2-panel">
      <h2>Published model catalog and default limits</h2>
      <p>Defaults are ${reference.defaults.development_usd} across providers, ${reference.defaults.per_review_usd} per review, and {reference.defaults.max_calls} calls per review. Operator settings may differ.</p>
      <div className="v2-table-wrap"><table><thead><tr><th>Provider</th><th>Model</th><th>Recorded price per million tokens</th></tr></thead><tbody>
        {reference.models.map(row => <tr key={row.model}><td>{row.provider}</td><td>{row.model}</td><td>${row.input} in / ${row.output} out <small><a href={row.source}>Catalog recorded {reference.price_date} ↗</a></small></td></tr>)}
      </tbody></table></div>
    </section>}
    {!config && referenceError && <p className="v2-empty">The published model catalog could not be loaded. Refresh the page to retry.</p>}
    {error && <p role="status" className="v2-access-note">{error}</p>}{config && <><div className="v2-metrics"><article><span>DEVELOPMENT LIMIT</span><strong>{money(config.budget.limit_usd)}</strong><small>Combined across providers</small></article><article><span>ACCOUNTED USE</span><strong>${config.budget.accounted_cost_usd.toFixed(5)}</strong><small>{config.budget.calls} calls</small></article><article><span>PER REVIEW</span><strong>{money(config.budget.per_run_usd)}</strong><small>At most {config.budget.max_calls} calls</small></article><article><span>EXTERNAL MODELS</span><strong className="v2-metric-word">{config.enabled ? 'Opt in' : 'Off'}</strong><small>No automatic paid retries</small></article></div>
      <section className="v2-panel"><h2>Specialist routing</h2><p>{config.privacy}</p><div className="v2-table-wrap"><table><thead><tr><th>Specialist</th><th>Provider / model</th><th>Price per 1M tokens</th><th>Connection</th></tr></thead><tbody>{config.routes.map(route => <tr key={route.task}><td><strong>{route.task}</strong><small>{route.reason}</small></td><td><span>{route.model_id}</span><small>{route.provider} · {route.family}</small></td><td>${route.input_per_million} in / ${route.output_per_million} out<small><a href={route.price_source} target="_blank" rel="noreferrer">Catalog · {route.price_checked} ↗</a></small></td><td><span className={`v2-badge ${route.configured ? 'green' : ''}`}>{route.configured ? 'Configured' : 'Not configured'}</span></td></tr>)}</tbody></table></div><p className="v2-footnote">Configuration confirms credentials are present. It does not establish model quality, a successful inference call, or the provider balance. App accounting is not a provider billing guarantee.</p></section>
      <div className="v2-two-columns"><section className="v2-panel"><h2>Repository policy</h2><p>Allowlisted public repositories:</p>{config.allowed_repositories.map(repo => <code className="v2-code-row" key={repo}>{repo}</code>)}<p>Repair write back and arbitrary repository execution are off.</p></section><section className="v2-panel"><h2>GitHub integration</h2><dl className="v2-settings-list"><div><dt>App credentials</dt><dd>{config.github_app.configured ? 'Configured' : 'Not configured'}</dd></div><div><dt>Signed webhook</dt><dd>{config.github_app.webhook_configured ? 'Configured' : 'Not configured'}</dd></div><div><dt>Publishing</dt><dd>{config.github_app.publish_enabled ? 'Owner opted in' : 'Disabled'}</dd></div></dl><p>Checks are SHA-specific and neutral. AegisPR never enables a required merge gate automatically.</p></section></div></>}
  </Workspace>;
}

const percent = (value: number | null) => value === null ? 'Not measured' : `${(value * 100).toFixed(1)}%`;

function BenchmarkSummary({ report, title }: { report: PublicReference['benchmark']; title: string }) {
  return <>
    <div className="v2-metrics">
      <article><span>PINNED FIXTURES</span><strong>{report.unique_cases}</strong><small>{report.repeats} repeats · {report.metrics.cases} observations</small></article>
      <article><span>FIXTURE PRECISION</span><strong>{percent(report.metrics.precision)}</strong><small>{report.metrics.true_positives} true positives · {report.metrics.false_positives} false positives</small></article>
      <article><span>FIXTURE RECALL</span><strong>{percent(report.metrics.recall)}</strong><small>{report.metrics.abstentions} abstentions</small></article>
      <article><span>MODEL COST</span><strong>{money(report.cost_usd)}</strong><small>Deterministic fixture profile</small></article>
    </div>
    <section className="v2-panel">
      <h2>{title}</h2>
      <p>{report.profile}</p>
      <code className="v2-long-hash">Dataset SHA256 {report.dataset_sha256}</code>
      <div className="v2-table-wrap"><table><thead><tr><th>Category</th><th>Observations</th><th>Precision</th><th>Recall</th><th>Abstentions</th></tr></thead><tbody>
        {Object.entries(report.categories).map(([category, metrics]) => <tr key={category}><td>{label(category)}</td><td>{metrics.cases}</td><td>{percent(metrics.precision)}</td><td>{percent(metrics.recall)}</td><td>{metrics.abstentions}</td></tr>)}
      </tbody></table></div>
      <p>Median time: {report.median_duration_ms} ms per review</p>
      {report.limitations.map(note => <p className="v2-footnote" key={note}>{note}</p>)}
    </section>
  </>;
}

export function BenchmarksPanel() {
  const { reference, referenceError } = usePublicReference();
  const [reports, setReports] = useState<BenchmarkReport[]>([]);
  const [job, setJob] = useState<BenchmarkJob | null>(null);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [repeats, setRepeats] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const current = await getBenchmarkJob();
      // A completed job guarantees its report is available to the following request.
      const history = await listBenchmarks();
      setReports(history); setJob(current); setOwner(true); setError('');
    } catch (cause) {
      setOwner(false); setReports([]); setJob(null); setError(errorText(cause));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); window.addEventListener(accessChangedEvent, load); return () => window.removeEventListener(accessChangedEvent, load); }, [load]);
  useEffect(() => {
    if (!owner || job?.status !== 'running') return;
    const timer = setTimeout(() => void load(), 2000);
    return () => clearTimeout(timer);
  }, [job, load, owner]);

  async function evaluate() {
    setStarting(true);
    setError('');
    try { setJob(await startBenchmarkJob(repeats)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setStarting(false); }
  }
  const report = reports[0];
  return <Workspace>
    <div className="v2-page-heading"><div><h1>Benchmarks</h1><p>Run the pinned fixtures and see how often AegisPR reproduced the changes it was expected to catch.</p></div><button className="v2-text-button" onClick={() => void load()}>Refresh ↻</button></div>
    <section className="v2-panel v2-help-panel">
      <h2>Run and read a fixture benchmark</h2>
      <ol><li>Save the owner code under <strong>Private deployment access</strong>.</li>
        <li>Set <strong>Suite repetitions</strong>. One pass records 12 observations. Three passes record 36.</li>
        <li>Click <strong>Run fixture benchmark</strong>. Each observation runs three base and three head checks. The page shows progress while the suite runs.</li>
        <li>Review the category table and open <strong>Inspect proof</strong> for an individual result. Use <strong>Download raw report</strong> to export the JSON.</li></ol>
      <p>Precision measures how many flagged regressions were expected. Recall measures how many expected regressions were found. Abstentions are cases where the runner withheld a verdict.</p>
      <Link className="v2-text-button" href="/guide#fixture-benchmarks">See the illustrated benchmark steps ↗</Link>
    </section>
    <div className="v2-scope"><strong>Evaluation scope</strong><span>Synthetic fixtures with hand-authored oracles. Zero model tokens. External ReviewBench scoring and provider comparisons are separate work.</span></div>
    <section className="v2-panel v2-help-panel" aria-label="Benchmark controls">
      <h2>Owner benchmark runner</h2>
      <div className="v2-run-controls">
        <label htmlFor="benchmark-repeats">Suite repetitions</label>
        <select id="benchmark-repeats" value={repeats} onChange={event => setRepeats(Number(event.target.value))} disabled={!owner || starting || job?.status === 'running'}>
          <option value="1">1 pass · 12 observations</option><option value="3">3 passes · 36 observations</option>
        </select>
        <button className="v2-button" disabled={!owner || starting || job?.status === 'running'} onClick={() => void evaluate()}>{starting || job?.status === 'running' ? 'Running fixture evaluation…' : 'Run fixture benchmark'}</button>
      </div>
      {loading && <p>Checking owner access…</p>}
      {error && <p role={owner ? 'alert' : 'status'} className={owner ? 'v2-error' : 'v2-access-note'}>{error}</p>}
      {job?.status === 'running' && <p role="status">{job.completed} of {job.total} observations completed. You can leave this page and return.</p>}
      {job?.status === 'completed' && <p role="status">Benchmark complete. {job.completed} observations recorded.</p>}
      {job?.status === 'failed' && <p role="alert" className="v2-error">The benchmark stopped early. Retry after checking the worker.</p>}
    </section>
    {report ? <>
      <BenchmarkSummary report={report} title={report.dataset} />
      <section className="v2-panel"><div className="v2-panel-heading"><h2>Run evidence</h2><button className="v2-text-button" onClick={() => downloadJson(report, 'aegispr-benchmark.json')}>Download raw report ↓</button></div>
        <div className="v2-table-wrap"><table><thead><tr><th>Fixture</th><th>Repeat</th><th>Result</th><th>Evidence</th></tr></thead><tbody>
          {report.raw.map(row => <tr key={row.run_id}><td>{row.fixture}</td><td>{row.repeat}</td><td><Status value={row.status} /></td><td><Link href={`/reviews/${row.run_id}`}>Inspect proof ↗</Link></td></tr>)}
        </tbody></table></div>
      </section>
    </> : owner && !loading && <section className="v2-panel v2-empty"><h2>No measured runs yet</h2><p>Run the pinned fixture benchmark to create actual results.</p></section>}
    {reference ? <section className="v2-reference" aria-label="Public reference benchmark">
      <BenchmarkSummary report={reference.benchmark} title={`Public reference run · ${reference.measurement_date}`} />
      <p className="v2-panel"><a href="https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/blob/main/evals/results/2026-11-13-dell-fixture-summary.json">View published benchmark evidence ↗</a></p>
    </section> : referenceError && <p className="v2-empty">The published reference could not be loaded. Refresh the page to retry.</p>}
  </Workspace>;
}
