import Image from 'next/image';
import Link from 'next/link';

const walkthrough = 'https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research/releases/tag/v2.0.0-walkthrough.1';

function GuideImage({ file, caption }: {file: string; caption: string}) {
  const src = `/guide-images/${file}.webp`;
  return <figure className="guide-figure">
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${caption}`}>
      <Image src={src} width={1440} height={960} alt={caption} unoptimized />
    </a>
    <figcaption>{caption} <a href={src} target="_blank" rel="noreferrer">Open full size ↗</a></figcaption>
  </figure>;
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
];

export default function GettingStarted() {
  return <div className="v2-guide illustrated-guide">
    <div className="guide-intro">
      <h1>Getting started with AegisPR</h1>
      <p>Run your first fixture, verify its evidence, and use the owner tools to review PRs or measure the fixture suite. Open any screenshot to see the controls at full size.</p>
      <a className="v2-button" href={walkthrough}>Watch the live walkthrough ↗</a>
    </div>
    <nav className="guide-chapters" aria-label="Guide chapters">
      {chapters.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}
    </nav>

    <section id="home" className="v2-panel">
      <h2>Find your way around</h2>
      <ol>
        <li>On the home page, select <strong>Try a live fixture</strong> to jump to the runner.</li>
        <li><strong>Reviews</strong> opens the workspace. <strong>Benchmarks</strong> opens results and suite controls. <strong>Models &amp; limits</strong> opens the model catalog and owner spending ledger. On a narrow screen, use <strong>Reviews</strong> and the Workspace navigation.</li>
        <li>The interactive terminal in the hero lets you preview a regression, a safe change, a repair, and sample test code before running anything.</li>
      </ol>
      <GuideImage file="home" caption="Home page showing Try a live fixture, version comparison, workspace links, and the interactive example." />
      <Link href="/">Open the home page ↗</Link>
    </section>

    <section id="live-fixture" className="v2-panel">
      <h2>Run a live fixture</h2>
      <ol>
        <li>Choose <strong>Rename coupon variables</strong> in the fixture dropdown.</li>
        <li>Click <strong>Run safe example</strong>. The review opens and refreshes while checks run.</li>
        <li>Wait for the result beside the review title. In this fixture, <strong>regression found</strong> means three base checks passed and three head checks failed.</li>
        <li>Open <strong>Findings</strong> for the source line and evidence links. Use the category filters or <strong>Export SARIF</strong> for a machine-readable report. Open <strong>Coverage</strong> to see analyzed and skipped files.</li>
      </ol>
      <GuideImage file="fixture" caption="Fixture dropdown and Run safe example in the Reviews workspace." />
      <Link href="/#run-fixture">Open the fixture runner ↗</Link>
    </section>

    <section id="proof-and-repair" className="v2-panel">
      <h2>Verify proof and repair</h2>
      <ol>
        <li>Click <strong>Proof</strong>. Compare the exact base and head commits. Expand a check to see its exit code, output, and environment.</li>
        <li>Click <strong>Verify receipt</strong> and look for <strong>Signature valid</strong>. <strong>Download receipt</strong> saves the signed JSON.</li>
        <li>In <strong>Resource usage</strong>, read API CPU and peak RAM, fixture CPU and RSS, and CUDA VRAM. Chromium may also report its JavaScript heap. Read the scope note before comparing the numbers.</li>
        <li>Open <strong>Repair</strong> and click <strong>Verify fixture repair</strong>. For the coupon fixture, <strong>fix verified</strong> indicates that all three checks of the prewritten patch passed.</li>
        <li>Open <strong>Models</strong> to confirm that the fixture used zero model calls. <strong>All reviews</strong> returns to the workspace.</li>
      </ol>
      <GuideImage file="proof" caption="Signed proof with the verification result and resource measurements from an actual run." />
      <GuideImage file="repair" caption="Repair tab showing a verified patch and its three repeat checks." />
    </section>

    <section id="owner-access" className="v2-panel">
      <h2>Unlock owner tools</h2>
      <ol>
        <li>Expand <strong>Private deployment access</strong> in the strip below the main navigation.</li>
        <li>Enter the owner code supplied by the deployment operator, then click <strong>Save access code</strong>. The code applies to this browser tab. The owner pages refresh after saving it.</li>
        <li>Use <strong>Clear saved code</strong> or close the tab when finished. Visitors can still see the public benchmark and model catalog.</li>
      </ol>
      <GuideImage file="access" caption="Private deployment access with an empty password field. The code is never shown here." />
    </section>

    <section id="pinned-review" className="v2-panel">
      <h2>Fill in a pull request</h2>
      <ol>
        <li>After saving the owner code, open <strong>Reviews</strong> and click <strong>Review a pull request</strong>.</li>
        <li>Paste a URL in the format <code>https://github.com/owner/repo/pull/123</code>. Choose an allowlisted public repository from Models &amp; limits.</li>
        <li>Enter the full 40-character base and head commit SHAs. From a checkout with the GitHub CLI, run <code>gh pr view PR_URL --json baseRefOid,headRefOid</code>. Use <code>baseRefOid</code> for Base and <code>headRefOid</code> for Head.</li>
        <li>Leave model use unchecked for a local-only review. If you opt in, check both <strong>Use paid specialists</strong> and the separate source-sharing consent.</li>
        <li>Click <strong>Start pinned review</strong>. If the PR changes, fetch both SHAs again. If the diff exceeds the operator limit, use a smaller PR. A completed source review displays <strong>analysis only</strong> and includes coverage and signed evidence.</li>
      </ol>
      <GuideImage file="pr" caption="Pinned review form showing the GitHub URL, exact SHA fields, and the two model consent controls." />
      <Link href="/#workspace">Open Reviews ↗</Link>
    </section>

    <section id="fixture-benchmarks" className="v2-panel">
      <h2>Run and read benchmarks</h2>
      <ol>
        <li>Open <strong>Benchmarks</strong>. Anyone can see the dated public reference run, its dataset hash, category results, and source evidence.</li>
        <li>After saving the owner code, set <strong>Suite repetitions</strong> to <strong>1 pass</strong> for 12 observations or <strong>3 passes</strong> for 36. Each observation performs six checks.</li>
        <li>Click <strong>Run fixture benchmark</strong>. Progress reports completed observations. You can navigate away and return to the job. The run uses zero provider credits.</li>
        <li>When it finishes, read precision, recall, abstentions and median time. <strong>Inspect proof</strong> opens a stored result. <strong>Download raw report</strong> saves the latest owner run as JSON.</li>
      </ol>
      <p>Precision is the proportion of flagged regressions that were expected. Recall is the proportion of expected regressions that were found. An abstention is a case where AegisPR withheld a verdict. External model and ReviewBench scores require separate evaluations.</p>
      <GuideImage file="benchmark-run" caption="Owner runner showing suite repetitions and live progress." />
      <GuideImage file="benchmark-result" caption="Completed fixture benchmark showing observations, precision, recall, abstentions, and model cost." />
      <Link href="/benchmarks">Open Benchmarks ↗</Link>
    </section>

    <section id="model-settings" className="v2-panel">
      <h2>Configure models and limits</h2>
      <ol>
        <li>Open <strong>Models &amp; limits</strong>. The signed-out page shows the published catalog and default budgets. The owner code unlocks the current policy and usage ledger.</li>
        <li>Read <strong>Development limit</strong> for the total app cap, <strong>Accounted use</strong> for estimated spend and calls, and <strong>Per review</strong> for that run’s spend and call ceiling.</li>
        <li>Read <strong>Specialist routing</strong> for task, provider, model, dated price and configuration. A configured credential indicates setup. Usage and account balances are tracked separately by each provider.</li>
        <li>To change the deployment, the operator edits its private <code>.env.v2</code>. Set <code>V2_ENABLE_MODELS</code>, <code>V2_BUDGET_USD</code>, <code>V2_RUN_BUDGET_USD</code> and <code>V2_MAX_CALLS</code>. Set <code>NEBIUS_API_KEY</code> or <code>VULTR_API_KEY</code> in that private file, recreate the API container, then click <strong>Refresh</strong>.</li>
        <li>To use models on one review, follow the PR consent steps above. Check the review’s <strong>Models</strong> tab for route decisions, input and output tokens, and cache hits.</li>
      </ol>
      <GuideImage file="models" caption="Owner Models &amp; limits with the configured spending caps and specialist routing." />
      <Link href="/settings">Open Models &amp; limits ↗</Link>
    </section>

    <section id="compare" className="v2-panel">
      <h2>Compare versions and use V1</h2>
      <p>Select <strong>Compare V1 and V2</strong> on the homepage for the feature matrix. Open the classic V1 interface for the original interactive example. V1’s generated-test execution and repair are available on a trusted private self-host installation.</p>
      <GuideImage file="compare" caption="Side-by-side comparison of the V1 foundation and features added in V2." />
      <Link href="/#compare-versions">Compare versions ↗</Link>
    </section>
  </div>;
}
