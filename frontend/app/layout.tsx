import type { Metadata } from "next";
import Link from "next/link";
import { DeploymentControls } from "@/components/deployment-controls";

import "./globals.css";


export const metadata: Metadata = {
  title: "AegisPR V2 — Reviews with evidence",
  description: "Commit-pinned review, repeated execution, signed evidence and bounded model specialists.",
  icons: { icon: "/brand/aegispr-logo.jpg", apple: "/brand/aegispr-logo.jpg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="AegisPR home">
            <span className="brand-shield" aria-hidden="true" />
            <span>Aegis<span className="brand-light">PR</span></span>
            <span className="v2-brand-tag">V2</span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/">Reviews</Link>
            <Link href="/benchmarks">Benchmarks</Link>
            <Link href="/settings">Models & limits</Link>
            <a href="https://github.com/Hari-Aditya-003/AegisPR-V2-Apart-Research" rel="noreferrer">GitHub ↗</a>
          </nav>
          <span className="v2-header-context">Apart Research workspace</span>
        </header>
        <DeploymentControls />
        <main id="main-content">{children}</main>
        <footer>
          <span>AegisPR</span>
          <p>Don&apos;t trust a PR. Prove it.</p>
          <p>V2 · Apart Research development · Prior work disclosed</p>
        </footer>
      </body>
    </html>
  );
}
