import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ChapterNav } from './chapter-nav';
import dimensions from './figure-dimensions.json';
import styles from './guide.module.css';

const walkthrough = 'https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/releases/tag/v2.0.0-walkthrough.1';

function GuideImage({ file, caption }: { file: keyof typeof dimensions; caption: string }) {
  const src = `/guide-focus/${file}.webp`;
  const { width, height } = dimensions[file];
  return <figure className={styles.figure}>
    <Image src={src} width={width} height={height} alt={caption} style={{ width, aspectRatio: `${width} / ${height}` }} unoptimized />
    <figcaption>
      {caption}<br />
      <a href={src} target="_blank" rel="noreferrer" aria-label={`Enlarge close-up: ${caption}`}>Enlarge close-up ↗</a>
    </figcaption>
  </figure>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.notice}>
    <strong>{title}</strong>
    <p>{children}</p>
  </div>;
}

const chapters = [
  ['home', 'Find your way around'],
  ['live-fixture', 'Run a live fixture'],
  ['proof-and-repair', 'Verify proof and repair'],
  ['owner-access', 'Unlock owner tools'],
  ['pinned-review', 'Fill in a pull request'],
  ['fixture-benchmarks', 'Run and read benchmarks'],
  ['model-settings', 'Configure models and limits'],
  ['compare', 'Compare versions and use V1'],
] as const;

export default function GettingStarted() {
  return <div className={styles.guide}>
    <div className={styles.intro}>
      <h1>Getting started with AegisPR</h1>
      <p>Follow the gold boxes in each close-up to find the exact controls. Use <strong>Enlarge close-up</strong> to inspect the detail at its original size.</p>
      <a className="v2-button" href={walkthrough}>Watch the live walkthrough ↗</a>
    </div>
    <div className={styles.layout}>
      <ChapterNav chapters={chapters} />
      <div className={styles.content}>
        <section id="home">
          <h2>Find your way around</h2>
          <Notice title="Where to start">The live fixture is the quickest way to see AegisPR produce new evidence. The version comparison shows which tools came from V1 and which were added in V2.</Notice>
          <ol>
            <li>On the home page, select <strong>Try a live fixture</strong> to jump to the runner.
              <GuideImage file="home" caption="Home page buttons for trying a live fixture and comparing versions." />
            </li>
            <li><strong>Reviews</strong> opens the workspace. <strong>Benchmarks</strong> opens results and suite controls. <strong>Models &amp; limits</strong> opens the model catalog and owner spending ledger. On a narrow screen, use <strong>Reviews</strong> and the Workspace navigation.</li>
            <li>The interactive terminal in the hero lets you preview a regression, a safe change, a repair, and sample test code before running anything.</li>
          </ol>
          <Link href="/">Open the home page ↗</Link>
        </section>

        <section id="live-fixture">
          <h2>Run a live fixture</h2>
          <Notice title="What to check">Use the coupon fixture to see the same check pass on base and fail on head. This repeatable example runs without an owner code or paid model calls.</Notice>
          <ol>
            <li>Choose <strong>Rename coupon variables</strong> in the fixture dropdown.</li>
            <li>Click <strong>Run safe example</strong>. The review opens and refreshes while checks run.
              <GuideImage file="fixture" caption="Fixture selector and Run safe example, outlined in gold." />
            </li>
            <li>Wait for the result beside the review title. In this fixture, <strong>regression found</strong> means three base checks passed and three head checks failed.</li>
            <li>Open <strong>Findings</strong> for the source line and evidence links. Use the category filters or <strong>Export SARIF</strong> for a machine-readable report. Open <strong>Coverage</strong> to see analyzed and skipped files.</li>
          </ol>
          <Link href="/#run-fixture">Open the fixture runner ↗</Link>
        </section>

        <section id="proof-and-repair">
          <h2>Verify proof and repair</h2>
          <Notice title="What counts as evidence">Look for three base passes, three head failures, and a valid receipt signature. After repair, the fix badge summarizes three successful checks of the prewritten patch.</Notice>
          <ol>
            <li>Click <strong>Proof</strong>. Compare the exact base and head commits. Expand a check to see its exit code, output, and environment.
              <GuideImage file="executions" caption="The first base and head checks. Expand either row to see its exit code and output." />
            </li>
            <li>Click <strong>Verify receipt</strong> and look for <strong>Signature valid</strong>. <strong>Download receipt</strong> saves the signed JSON.
              <GuideImage file="proof" caption="Verify receipt button and the Signature valid result underneath." />
            </li>
            <li>In <strong>Resource usage</strong>, read API CPU and peak RAM, fixture CPU and RSS, and CUDA VRAM. Chromium may also report its JavaScript heap. Read the scope note before comparing the numbers.
              <GuideImage file="resources" caption="Resource usage panel with fixture CPU time and CUDA device memory outlined." />
            </li>
            <li>Open <strong>Repair</strong> and click <strong>Verify fixture repair</strong>. For the coupon fixture, <strong>fix verified</strong> indicates that all three checks of the prewritten patch passed.
              <GuideImage file="repair" caption="Repair tab showing a verified patch and its three repeat checks." />
            </li>
            <li>Open <strong>Models</strong> to confirm that the fixture used zero model calls. <strong>All reviews</strong> returns to the workspace.</li>
          </ol>
        </section>

        <section id="owner-access">
          <h2>Unlock owner tools</h2>
          <Notice title="Keep the code private">The deployment operator supplies the access code. Save it in the password field to unlock owner actions in this tab.</Notice>
          <ol>
            <li>Expand <strong>Private deployment access</strong> in the strip below the main navigation.</li>
            <li>Enter the owner code supplied by the deployment operator, then click <strong>Save access code</strong>. The code applies to this browser tab. The owner pages refresh after saving it.
              <GuideImage file="access" caption="Private deployment access with an empty password field. The code is never shown here." />
            </li>
            <li>Use <strong>Clear saved code</strong> or close the tab when finished. Visitors can still see the public benchmark and model catalog.</li>
          </ol>
        </section>

        <section id="pinned-review">
          <h2>Fill in a pull request</h2>
          <Notice title="Use exact commits">The base and head SHAs pin the review to the code you intend to inspect. Fetch both again if the pull request changes before you submit.</Notice>
          <ol>
            <li>After saving the owner code, open <strong>Reviews</strong> and click <strong>Review a pull request</strong>.</li>
            <li>Paste a URL in the format <code>https://github.com/owner/repo/pull/123</code>. Choose an allowlisted public repository from Models &amp; limits.</li>
            <li>Enter the full 40-character base and head commit SHAs. From a checkout with the GitHub CLI, run <code>gh pr view PR_URL --json baseRefOid,headRefOid</code>. Use <code>baseRefOid</code> for Base and <code>headRefOid</code> for Head.
              <GuideImage file="pr-fields" caption="Pinned review fields. The base and head commit inputs are outlined." />
            </li>
            <li>Leave model use unchecked for a local-only review. If you opt in, check both <strong>Use paid specialists</strong> and the separate source-sharing consent.
              <GuideImage file="pr-consent" caption="Paid specialists checkbox and the separate source-sharing consent." />
            </li>
            <li>Click <strong>Start pinned review</strong>. If the PR changes, fetch both SHAs again. If the diff exceeds the operator limit, use a smaller PR. A completed source review displays <strong>analysis only</strong> and includes coverage and signed evidence.</li>
          </ol>
          <Link href="/#workspace">Open Reviews ↗</Link>
        </section>

        <section id="fixture-benchmarks">
          <h2>Run and read benchmarks</h2>
          <Notice title="Read the scope before comparing scores">These scores describe the curated fixture suite. Use one pass for a quick check or three passes to see whether the results repeat.</Notice>
          <ol>
            <li>Open <strong>Benchmarks</strong>. Anyone can see the dated public reference run, its dataset hash, category results, and source evidence.</li>
            <li>After saving the owner code, set <strong>Suite repetitions</strong> to <strong>1 pass</strong> for 12 observations or <strong>3 passes</strong> for 36. Each observation performs six checks.</li>
            <li>Click <strong>Run fixture benchmark</strong>. Progress reports completed observations. You can navigate away and return to the job. The run uses zero provider credits.
              <GuideImage file="benchmark-run" caption="Suite repetitions and Run fixture benchmark controls above the completion status." />
            </li>
            <li>When it finishes, read precision, recall, abstentions and median time. <strong>Inspect proof</strong> opens a stored result. <strong>Download raw report</strong> saves the latest owner run as JSON.
              <GuideImage file="benchmark-result" caption="Completed fixture benchmark showing observations, precision, recall, abstentions, and model cost." />
            </li>
          </ol>
          <p>Precision is the proportion of flagged regressions that were expected. Recall is the proportion of expected regressions that were found. An abstention is a case where AegisPR withheld a verdict. External model and ReviewBench scores require separate evaluations.</p>
          <Link href="/benchmarks">Open Benchmarks ↗</Link>
        </section>

        <section id="model-settings">
          <h2>Configure models and limits</h2>
          <Notice title="Check the per-review cap">The app ledger tracks estimated usage against the configured cap. The provider dashboard tracks account billing and remaining credits.</Notice>
          <ol>
            <li>Open <strong>Models &amp; limits</strong>. The signed-out page shows the published catalog and default budgets. The owner code unlocks the current policy and usage ledger.</li>
            <li>Read <strong>Development limit</strong> for the total app cap, <strong>Accounted use</strong> for estimated spend and calls, and <strong>Per review</strong> for that run’s spend and call ceiling.
              <GuideImage file="models" caption="The deployment spending cards, with the per-review cap outlined." />
            </li>
            <li>Read <strong>Specialist routing</strong> for task, provider, model, dated price and configuration. A configured credential indicates setup. Usage and account balances are tracked separately by each provider.
              <GuideImage file="routing" caption="The provider and model assigned to a specialist, with the price and configuration alongside." />
            </li>
            <li>To change the deployment, the operator edits its private <code>.env.v2</code>. Set <code>V2_ENABLE_MODELS</code>, <code>V2_BUDGET_USD</code>, <code>V2_RUN_BUDGET_USD</code> and <code>V2_MAX_CALLS</code>. Set <code>NEBIUS_API_KEY</code> or <code>VULTR_API_KEY</code> in that private file, recreate the API container, then click <strong>Refresh</strong>.</li>
            <li>To use models on one review, follow the PR consent steps above. Check the review’s <strong>Models</strong> tab for route decisions, input and output tokens, and cache hits.</li>
          </ol>
          <Link href="/settings">Open Models &amp; limits ↗</Link>
        </section>

        <section id="compare">
          <h2>Compare versions and use V1</h2>
          <Notice title="Choose the workflow that fits">Use V2 when you need a signed fixture receipt or a pinned source review. Use the private V1 deployment for its generated-test workflow.</Notice>
          <p>Select <strong>Compare V1 and V2</strong> on the homepage for the feature matrix. Open the classic V1 interface for the original interactive example. V1’s generated-test execution and repair are available on a trusted private self-host installation.</p>
          <GuideImage file="compare" caption="Comparison table with the V2 additions column outlined." />
          <Link href="/#compare-versions">Compare versions ↗</Link>
        </section>
      </div>
    </div>
  </div>;
}
