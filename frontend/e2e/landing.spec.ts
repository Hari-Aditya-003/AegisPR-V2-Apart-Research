import { expect, test } from "@playwright/test";

test("home keeps the original look and leads to the version comparison and live tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const title = page.getByRole("heading", { name: "Don't trust a PR. Prove it." });
  await expect(title).toBeVisible();
  const hero = page.getByRole("region", { name: "Don't trust a PR. Prove it." });
  await hero.getByRole("link", { name: "Compare V1 and V2" }).click();
  await expect(page).toHaveURL(/#compare-versions$/);
  await expect(page.locator("#compare-versions").getByRole("heading")).toBeInViewport();
  await expect(page.getByRole("table", { name: "AegisPR V1 and V2 capabilities" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "V1 foundation" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "V2 additions" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await hero.getByRole("link", { name: "Try a live fixture" }).click();
  await expect(page).toHaveURL(/#run-fixture$/);
  await expect(page.locator("#run-fixture").getByRole("heading")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Run safe example" })).toBeVisible();
});

test("paused motion does not hide newly entered evidence panels", async ({ page }) => {
  await page.goto("/legacy");
  await page.getByRole("button", { name: /Pause animation$/ }).click();
  const logo = page.getByAltText("AegisPR shield and branching circuit logo");
  expect(await logo.evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  await page.getByRole("button", { name: "Safe change", exact: true }).click();
  const evidence = page.locator(".preview-result");
  expect(await evidence.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  await page.getByRole("button", { name: /Resume animation$/ }).click();
  expect(await logo.evaluate(node => getComputedStyle(node).animationName)).not.toBe("none");
});

test("private evidence retries after a session access code without exposing it in the page", async ({ page }) => {
  await page.route("http://localhost:8000/api/verifications/private-run", async route => {
    const authorized = route.request().headers().authorization === "Bearer reviewer-session-code";
    await route.fulfill({ status: authorized ? 404 : 401, contentType: "application/json", body: JSON.stringify({ detail: "No report" }) });
  });
  await page.goto("/verifications/private-run");
  await expect(page.locator(".report-error")).toContainText("save the deployment access code");
  await page.getByText("Private deployment access", { exact: true }).click();
  await page.getByLabel("Deployment access code", { exact: true }).fill("reviewer-session-code");
  await page.getByRole("button", { name: "Save access code", exact: true }).click();
  await expect(page.locator(".report-error")).toContainText("No report");
  await expect(page.getByLabel("Deployment access code", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole("button", { name: "Clear saved code", exact: true }).click();
  await expect(page.locator(".report-error")).toContainText("save the deployment access code");
});

test("visitor can explore example outcomes and test code with the keyboard", async ({ page }) => {
  await page.goto("/legacy");
  await expect(page.getByText("Interactive example · not a live review")).toBeVisible();
  const safeChange = page.getByRole("button", { name: "Safe change", exact: true });
  await safeChange.focus();
  await page.keyboard.press("Enter");
  await expect(safeChange).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("VERIFIED WITHIN SCOPE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verified repair", exact: true }).click();
  await expect(page.getByText("FIX VERIFIED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show test code", exact: true }).click();
  await expect(page.getByText(/def test_discount_boundary/)).toBeVisible();
  await page.getByRole("button", { name: "Show evidence", exact: true }).click();
  await expect(page.getByText("FIX VERIFIED", { exact: true })).toBeVisible();
});

test("branded mobile page fits the viewport and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/legacy");
  const logo = page.getByAltText("AegisPR shield and branching circuit logo");
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await logo.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel(/github pull request/i)).toBeVisible();
});


test("visitor can understand and start the verification flow", async ({ page }) => {
  await page.route("http://localhost:8000/api/verifications", async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "run-e2e" }) });
  });
  await page.route("http://localhost:8000/api/verifications/run-e2e", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "run-e2e",
        pull_request_url: "https://github.com/acme/store/pull/42",
        status: "VERIFIED_WITHIN_SCOPE",
        model_used: "nvidia/nemotron",
        summary: {
          owner: "acme", repository: "store", number: 42, title: "Coupon boundary verification",
          base_commit: "a".repeat(40), head_commit: "b".repeat(40), changed_files: 1, additions: 4, deletions: 1,
        },
        stages: [{ key: "report", label: "Evidence report completed", state: "complete", detail: "Stored" }],
        findings: [], changed_files: ["coupon.py"], hypotheses: [],
        metrics: { files_analyzed: 3, hypotheses_generated: 0, generated_tests: 0, regressions_found: 0, model_calls: 1, context_accelerator: "cuda", analysis_duration_ms: 1, sandbox_duration_ms: 1 },
        disclaimer: "Evidence is scoped to the checks executed in this run.",
      }),
    });
  });
  await page.goto("/legacy");
  await expect(page.getByRole("heading", { name: /don't trust a pr/i })).toBeVisible();
  await page.getByLabel(/github pull request/i).fill("https://github.com/acme/store/pull/42");
  await page.getByRole("button", { name: /verify pr/i }).click();
  await expect(page).toHaveURL(/\/verifications\/run-e2e/);
  await expect(page.getByRole("heading", { name: "Coupon boundary verification" })).toBeVisible();
  await expect(page.getByText("VERIFIED WITHIN TESTED SCOPE")).toBeVisible();
});


test("visitor receives validation feedback for a non-GitHub URL", async ({ page }) => {
  await page.goto("/legacy");
  await page.getByLabel(/github pull request/i).fill("https://example.com/pull/42");
  await page.getByRole("button", { name: /verify pr/i }).click();
  await expect(page.locator("#pr-error")).toContainText("public GitHub pull request");
});


test("reviewer can generate and verify an isolated repair", async ({ page }) => {
  let repairStarted = false;
  const regression = {
    id: "run-repair",
    pull_request_url: "https://github.com/acme/store/pull/42",
    status: "REGRESSION_FOUND",
    summary: {
      owner: "acme", repository: "store", number: 42, title: "Coupon repair",
      base_commit: "a".repeat(40), head_commit: "b".repeat(40), changed_files: 1, additions: 4, deletions: 1,
    },
    stages: [{ key: "report", label: "Evidence report completed", state: "complete", detail: "Stored" }],
    findings: [{
      id: "finding-1", classification: "REGRESSION", severity: "high", summary: "Negative total",
      affected_file: "coupon.py", root_cause: "The result is not clamped.",
      base_execution: { branch: "base", commit: "a".repeat(40), status: "PASSED", stdout: "", stderr: "", duration_ms: 4 },
      head_execution: { branch: "head", commit: "b".repeat(40), status: "FAILED", stdout: "", stderr: "", duration_ms: 5 },
    }],
    changed_files: ["coupon.py"],
    hypotheses: [{ id: "H1", description: "Negative total", test_strategy: "Oversized discount" }],
    metrics: { files_analyzed: 3, hypotheses_generated: 1, generated_tests: 1, regressions_found: 1, context_accelerator: "cuda" },
    disclaimer: "Evidence is scoped to executed checks.",
  };
  await page.route("http://localhost:8000/api/verifications/run-repair/repair", async (route) => {
    repairStarted = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ...regression, status: "RUNNING", repair: { finding_id: "finding-1", status: "PENDING", patch: "", summary: "", checks: [] } }),
    });
  });
  await page.route("http://localhost:8000/api/verifications/run-repair", async (route) => {
    const body = repairStarted ? {
      ...regression,
      status: "FIX_VERIFIED",
      repair: {
        finding_id: "finding-1", status: "VERIFIED",
        patch: "diff --git a/coupon.py b/coupon.py", summary: "Clamp the result at zero.",
        checks: [{ name: "existing_tests", command: "pytest -q", execution: { branch: "repair", commit: "b".repeat(40), status: "PASSED", stdout: "", stderr: "", duration_ms: 8 } }],
      },
    } : regression;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/verifications/run-repair");
  await page.getByRole("button", { name: /generate and verify repair/i }).click();
  await expect(page.getByText("Clamp the result at zero.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repair evidence" })).toBeVisible();
  await expect(page.getByText("View isolated patch")).toBeVisible();
});

test("guide pins chapter navigation and links to marked close-ups", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/guide");
    const nav = page.getByRole("navigation", { name: "Guide chapters" });
    const chapter = nav.getByRole("link", { name: "Verify proof and repair" });
    const proof = page.locator("#proof-and-repair");
    await chapter.click();
    await expect(page).toHaveURL(/#proof-and-repair$/);
    await expect(proof.getByRole("heading", { name: "Verify proof and repair" })).toBeInViewport();
    await expect(chapter).toHaveAttribute("aria-current", "location");
    const top = await nav.evaluate(element => element.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollBy(0, 180));
    expect(await nav.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
    await expect(proof.getByText("What counts as evidence")).toBeVisible();

    const closeUp = proof.getByRole("img", { name: /Verify receipt button/ });
    await closeUp.scrollIntoViewIfNeeded();
    await expect.poll(() => closeUp.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const zoom = proof.getByRole("link", { name: /Enlarge close-up: Verify receipt/ });
    await expect(zoom).toHaveAttribute("href", "/guide-focus/proof.webp");
    await expect(zoom).toHaveAttribute("target", "_blank");
    const crop = await page.request.get(new URL("/guide-focus/proof.webp", page.url()).href);
    expect(crop.ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("guide keeps the active chapter visible in a short desktop window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 365 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/guide#compare");
  const nav = page.getByRole("navigation", { name: "Guide chapters" });
  const active = nav.getByRole("link", { name: "Compare versions and use V1" });
  await expect(active).toHaveAttribute("aria-current", "location");
  await expect(active).toBeInViewport({ ratio: 0.95 });
  expect(await nav.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
