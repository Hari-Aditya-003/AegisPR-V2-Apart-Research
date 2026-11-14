import Link from 'next/link';

export default function GettingStarted() {
  return <div className="v2-guide">
    <h1>Getting started with AegisPR</h1>
    <section className="v2-panel">
      <h2>Run your first review</h2>
      <ol>
        <li>Open Reviews and choose the coupon fixture.</li>
        <li>Run the fixture. AegisPR checks the base and head commits three times each.</li>
        <li>Open Proof to see the checks and verify or download the signed receipt.</li>
        <li>Open Repair to verify the prewritten fixture patch. Open Resource usage to see where the work ran.</li>
      </ol>
      <Link href="/">Open reviews ↗</Link>
    </section>
    <section className="v2-panel">
      <h2>Review an allowlisted pull request</h2>
      <p>Open Private deployment access and save your owner code for this tab. In Reviews, select Review a pull request and enter the GitHub URL and the exact base and head commit SHAs.</p>
      <p>V2 records changed-file coverage and source findings. Model specialists require explicit consent. The owner can inspect the budget on Models &amp; limits and run the fixture suite on Benchmarks.</p>
    </section>
    <section className="v2-panel">
      <h2>Run the original verification workflow</h2>
      <p>V1 includes generated tests, a verification timeline and repair checks. Operators run it on a trusted, private deployment. The public V2 workspace uses curated fixtures for execution.</p>
      <a href="https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research">Open the source and self-hosting instructions ↗</a>
    </section>
  </div>;
}
