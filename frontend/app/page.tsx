import Link from "next/link";

import { VerificationPreview } from "@/components/verification-preview";
import { ReviewDashboard } from "@/components/v2-workspace";

const capabilities = [
  ["Pull requests", "Generated tests on a trusted private installation", "Source review of allowlisted PRs pinned to exact commits"],
  ["Base and head checks", "Run the same generated test on both commits", "Run a curated check three times on each commit"],
  ["Evidence", "Timeline, test code, and execution output", "Signed receipts, changed-file coverage, and SARIF export"],
  ["Repair", "Explicit patch verification on a trusted private installation", "Rerun the prewritten fixture patch and inspect the signed result"],
  ["Models and resources", "Nebius reasoning and CUDA context ranking", "Owner-controlled model spending, fixture benchmarks, and runtime measurements"],
];

export default function Page() {
  return (
    <>
      <section className="hero unified-hero" aria-labelledby="home-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="verify-panel">
          <p className="eyebrow">Pull request verification</p>
          <h1 id="home-title">Don&apos;t trust a PR. <span>Prove it.</span></h1>
          <p className="hero-copy">
            Compare the original and changed code, inspect what each check found, and verify the signed evidence.
          </p>
          <div className="unified-actions">
            <Link className="v2-button" href="#run-fixture">Try a live fixture</Link>
            <Link className="v2-button secondary" href="#compare-versions">Compare V1 and V2</Link>
          </div>
          <p className="field-hint">Live fixtures run without a sign-in or paid model calls.</p>
        </div>
        <VerificationPreview />
      </section>
      <section id="compare-versions" className="section muted version-comparison" aria-labelledby="comparison-heading">
        <div className="section-heading">
          <h2 id="comparison-heading">V1 and V2 compared</h2>
          <p>One workspace with the original AegisPR interface and the V2 review tools.</p>
        </div>
        <div className="version-table">
          <table aria-label="AegisPR V1 and V2 capabilities">
            <thead><tr><th scope="col">Workflow</th><th scope="col">V1 foundation</th><th scope="col">V2 additions</th></tr></thead>
            <tbody>
              {capabilities.map(([name, v1, v2]) => (
                <tr key={name}><th scope="row">{name}</th><td>{v1}</td><td>{v2}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="unified-actions">
          <Link className="v2-button secondary" href="/legacy">Open the original V1 interface</Link>
          <Link className="v2-button" href="#workspace">Open the review workspace</Link>
        </div>
      </section>
      <section id="workspace" className="unified-workspace" aria-label="Review workspace">
        <ReviewDashboard />
      </section>
    </>
  );
}
