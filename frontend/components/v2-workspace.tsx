"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createReview, getModelConfig, getV2Health, listFixtures, listReviews, startSafeDemo } from '@/lib/v2-api';
import { accessChangedEvent } from '@/lib/api';
import type { Fixture, ModelConfig, Review, V2Health } from '@/lib/v2-types';

export const money = (amount: number) => '$' + amount.toFixed(amount > 0 && amount < .01 ? 6 : 2);
export const label = (text: string) => text.replaceAll('_', ' ').toLowerCase();

export function Workspace({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div className="v2-layout"><aside className="v2-sidebar"><p className="v2-overline">WORKSPACE</p>
    <nav aria-label="Workspace navigation">{[['/', '◈', 'Reviews'], ['/benchmarks', '▥', 'Benchmarks'], ['/settings', '⚙', 'Models & limits']].map(([href, icon, name]) =>
      <Link key={href} href={href} className={path === href || href === '/' && path?.startsWith('/reviews') ? 'selected' : ''}><span aria-hidden="true">{icon}</span>{name}</Link>)}</nav>
    <div className="v2-sidebar-bottom"><span className="v2-status-dot" />Evidence first<p>Models propose.<br />Executed checks establish proof.</p>
      <a href="https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/blob/main/PRIOR_WORK.md" target="_blank" rel="noreferrer">Prior work & provenance ↗</a></div>
  </aside><div className="v2-content">{children}</div></div>;
}

export function Status({ value }: { value: string }) {
  return <span className={`v2-badge ${value.includes('REGRESSION') || value.includes('ERROR') ? 'red' : value.includes('VERIFIED') ? 'green' : 'neutral'}`}>{label(value)}</span>;
}

export function ReviewDashboard() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [health, setHealth] = useState<V2Health | null>(null);
  const [fixture, setFixture] = useState('py-coupon-floor');
  const [loading, setLoading] = useState(true);
  const [ownerError, setOwnerError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false);
  const [useModels, setUseModels] = useState(false);
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setOwnerError('');
    const results = await Promise.allSettled([listReviews(), getModelConfig(), listFixtures(), getV2Health()]);
    if (results[0].status === 'fulfilled') setReviews(results[0].value); else setOwnerError('Saved reviews require owner access. Safe examples are available below.');
    if (results[1].status === 'fulfilled') setConfig(results[1].value);
    if (results[2].status === 'fulfilled') setFixtures(results[2].value); else setError('The review service is unavailable. Check the connection and retry.');
    if (results[3].status === 'fulfilled') setHealth(results[3].value);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); window.addEventListener(accessChangedEvent, load); return () => window.removeEventListener(accessChangedEvent, load); }, [load]);

  async function demo() {
    setBusy(true); setError('');
    try { const run = await startSafeDemo(fixture); router.push(`/reviews/${run.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Safe run could not start.'); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const run = await createReview({ mode: 'pr', pull_request_url: String(data.get('url')), base_sha: String(data.get('base')), head_sha: String(data.get('head')),
        use_models: useModels, allow_external_code: useModels && consent });
      router.push(`/reviews/${run.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review could not start.'); }
    finally { setBusy(false); }
  }
  const reproduced = reviews.filter(run => run.status === 'REGRESSION_FOUND').length;
  return <Workspace><div className="v2-page-heading"><div><p className="v2-overline">AEGISPR / REVIEW WORKSPACE</p><h1>Reviews with evidence.</h1><p>Inspect changes. Reproduce behavior. Keep uncertainty visible.</p></div>
    <button className="v2-button secondary" onClick={() => setForm(!form)}>Review a pull request <span aria-hidden="true">↗</span></button></div>
    <div className="v2-metrics"><article><span>RECENT REVIEWS</span><strong>{loading ? '—' : reviews.length}</strong><small>Latest up to 30 records</small></article>
      <article><span>REPRODUCED REGRESSIONS</span><strong>{loading ? '—' : reproduced}</strong><small>Within executed scope</small></article>
      <article className="v2-cost-metric"><span>ACCOUNTED MODEL COST</span><strong>{config ? money(config.budget.accounted_cost_usd) : '—'}</strong><small>App ledger · conservative estimate</small></article>
      <article><span>DEVELOPMENT LIMIT</span><strong>{config ? money(config.budget.limit_usd) : '—'}</strong><small>{config ? `${money(config.budget.per_run_usd)} per review` : 'Owner access to view limits'}</small></article></div>
    {form && <form className="v2-panel v2-pr-form" onSubmit={submit}><div className="v2-panel-heading"><h2>Review pinned changes</h2><span className="v2-badge">Owner access</span></div>
      <p>Allowlisted public repositories only. Source review runs first; arbitrary installs and tests are disabled.</p>
      <label>GitHub pull request URL<input name="url" type="url" required placeholder="https://github.com/owner/repo/pull/123" /></label>
      <div className="v2-two-columns"><label>Base commit SHA<input name="base" required pattern="[0-9a-f]{40}" minLength={40} maxLength={40} /></label><label>Head commit SHA<input name="head" required pattern="[0-9a-f]{40}" minLength={40} maxLength={40} /></label></div>
      <label className="v2-checkbox"><input type="checkbox" checked={useModels} onChange={event => setUseModels(event.target.checked)} />Use paid specialists within the configured limits</label>
      {useModels && <label className="v2-checkbox"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />Send this public source to the configured Nebius and Vultr models for this review</label>}
      <button className="v2-button" disabled={busy}>Start pinned review</button></form>}
    {error && <p className="v2-error" role="alert">{error}</p>}
    <div className="v2-overview-grid"><section className="v2-panel v2-demo-panel"><div className="v2-panel-heading"><span className="v2-overline">LIVE SAFE EXAMPLE</span><span className="v2-badge green">No tokens required</span></div>
      <h2>Run it. Then inspect the proof.</h2><p>A committed fixture runs on base and head three times each. The output, exact commits, and signed receipt are produced for your new run.</p>
      <label className="v2-overline" htmlFor="safe-fixture">CHOOSE A FIXTURE</label><select id="safe-fixture" value={fixture} onChange={event => setFixture(event.target.value)}>
        {fixtures.length ? fixtures.map(item => <option key={item.id} value={item.id}>{item.title} · {item.language}</option>) : <option value="py-coupon-floor">Coupon boundary · Python</option>}</select>
      <div className="v2-demo-action"><button className="v2-button" disabled={busy} onClick={demo}>{busy ? 'Starting execution…' : 'Run safe example'} <span aria-hidden="true">→</span></button><small>Prewritten tests · controlled fixture<br />No repository writes</small></div>
      <div className="v2-mini-pipeline"><span>BASE + HEAD</span><b>→</b><span>3 REPEATS</span><b>→</b><span>SIGNED EVIDENCE</span></div></section>
      <section className="v2-panel v2-system"><div className="v2-panel-heading"><h2>Execution environment</h2><span className="v2-status-dot" /></div>
        <dl><div><dt>Execution</dt><dd>{health?.executor ?? 'Checking connection'}</dd></div><div><dt>GPU worker</dt><dd>{health?.gpu_accelerator === 'cuda' ? 'CUDA available' : health?.gpu_accelerator ?? 'Checking'}</dd></div>
          <div><dt>Paid specialists</dt><dd>{config ? config.enabled ? 'Available with consent' : 'Disabled by operator' : 'Owner access required'}</dd></div><div><dt>Write back</dt><dd>Off by default</dd></div></dl>
        <p>Safe examples use fixed, reviewed source. Free-form repository execution stays closed until its isolation checks pass.</p><Link href="/settings">View models & limits <span aria-hidden="true">↗</span></Link></section></div>
    <section className="v2-panel v2-recent"><div className="v2-panel-heading"><div><span className="v2-overline">ACTIVITY</span><h2>Recent reviews</h2></div><button className="v2-text-button" onClick={() => void load()}>Refresh ↻</button></div>
      {ownerError ? <p className="v2-empty">{ownerError}</p> : loading ? <p className="v2-empty">Loading reviews…</p> : reviews.length === 0 ? <div className="v2-empty"><span aria-hidden="true">◈</span><h3>No reviews yet</h3><p>Start a safe example to create the first evidence record.</p></div> :
        <div className="v2-table-wrap"><table><thead><tr><th>Review</th><th>Evidence</th><th>Findings</th><th>Model cost</th></tr></thead><tbody>{reviews.map(run => <tr key={run.id}><td><Link href={`/reviews/${run.id}`}>{run.title}<small>{run.mode === 'fixture' ? 'Controlled fixture' : 'Pinned public PR'} · {run.head_sha?.slice(0, 8) || 'Collecting'}</small></Link></td><td><Status value={run.status} /></td><td>{run.findings.length}</td><td>{money(run.cost.accounted_cost_usd)}</td></tr>)}</tbody></table></div>}
    </section><p className="v2-footnote">V2 work builds on the original AegisPR project. Inherited code and dated evidence are disclosed in the repository; a new name does not make prior work new.</p>
  </Workspace>;
}
