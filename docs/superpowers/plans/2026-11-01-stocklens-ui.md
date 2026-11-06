# StockLens UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the existing Thai StockLens app on desktop/tablet/mobile with truthful states and consistent Lucide/Simple Icons assets.

**Architecture:** Retain the existing buildless HTML/JavaScript and API contracts. Introduce a small local icon registry and coherent CSS tokens, refine the shared shell and each existing route, and verify actual rendered flows rather than replacing the app with a new framework.

**Tech Stack:** HTML, CSS, browser JavaScript, Lucide SVG, Simple Icons SVG, Playwright, Node.js 24+.

**Spec:** ../specs/2026-11-01-stocklens-free-cloud-design.md

## Global Constraints

- Keep StockLens branding, muted navy, Thai copy, Inter/Noto Sans Thai and existing account/API behavior.
- Preserve plain HTML/CSS/JavaScript; do not add a framework, fake news, fake prices, invented AI results or holdings inputs.
- Test 390, 768, 1440px; controls require accessible names and keyboard focus; fixed navigation must not cover content.
- Bundle only icons used, document versions/licenses, and serve new assets through an explicit static allowlist.
- Explain missing services and Render sleep limitations; no claim of continuous Push on the free host.

## Review Focus

- A narrow screen with long Thai titles/company names must remain readable without horizontal overflow (Task 2).
- Mobile More navigation must expose every secondary route and return focus on close (Task 2).
- Missing-brand assets must fall back to a ticker with an accessible company name, not broken image chrome (Task 1).
- Failed saves/network failures must retain form input and never show success or erase private state incorrectly (Task 3).
- Signed-out/offline/expired-session screens must not expose prior private data or imply live news is cached (Task 3).

## File map

- dist/icons.js and dist/vendor/: selected icon registry/assets, sources and licenses.
- dist/index.html, dist/app.js, dist/auth.js: shared shell, navigation, overview and auth presentation.
- dist/styles.css, dist/theme.css, dist/features.css, dist/ui-polish.css: retain existing responsibilities, reduce conflicting overrides when touched; use shared tokens.
- dist/security-ui.js, dist/push-ui.js, dist/research-ui.js, dist/quotes-ui.js: service feedback and consistent controls.
- dist/company-icons.js, dist/catalog.js: canonical icon availability and ticker fallback.
- server.mjs: explicit asset registry; tests/catalog/browser/PWA and new responsive coverage; DESIGN.md and CI.

### Task 1: Canonical icon assets and a recorded baseline

**Files:** dist/icons.js; dist/vendor/ICONS.md; selected local SVGs; dist/company-icons.js; dist/catalog.js; dist/index.html; dist/app.js; server.mjs; test/catalog.test.mjs; test/browser.mjs.

**Interfaces:** `StockLensIcons.icon(name,{size=20}={}) -> trusted SVG markup` for the fixed local registry; keep existing icon aliases for current templates. Company icon map returns a served local path or null; companyLogo retains its existing symbol input and accessible company/ticker output.

- [ ] Run the unchanged app and existing browser tests using test-only data; record before screenshots at 390/768/1440. Read Taste app-screens.md, Impeccable craft-floor.md immediately before UI edits, and existing DESIGN.md. Prepare the relevant Taste draw/inspect scripts from the requested source and keep palette/type; if a tool cannot run, state the limitation and use actual Playwright captures.
- [ ] Add meaningful coverage for available icon paths returning 200, every brand fallback having a company/ticker name, and icon-only controls having an accessible name. Do not test exact SVG path strings.
- [ ] Vendor only the selected canonical Lucide/Simple Icons SVGs from a recorded upstream version. Keep StockLens' own logo. Replace handcrafted generic icon paths/Unicode control glyphs via the registry, set decorative SVGs aria-hidden and use consistent currentColor stroke.
- [ ] Keep unavailable Simple Icons brands as ticker fallbacks. Update the server's explicit asset list, company icon tests and PWA expectations; preserve browser CSP and no external icon network calls.
- [ ] Run catalog/API tests and browser smoke; check no missing assets, then commit.

### Task 2: Shared frame, mobile navigation and task-first overview

**Files:** dist/index.html; dist/app.js; dist/auth.js; dist/styles.css; dist/theme.css; dist/features.css; dist/ui-polish.css; test/browser.mjs; new test/responsive-browser.mjs; package.json.

**Interfaces:** Preserve existing `data-page` routes and actions. Add a labelled mobile nav for overview/news/following and a More control opening the secondary-route list; selecting a route updates aria-current and focuses the destination heading. Desktop sidebar remains labelled.

- [ ] Add Playwright checks that every route can be reached at 390/768/1440, that More closes and returns focus with Escape, that the current destination is identifiable, and that page scrollWidth does not exceed viewport width. Include long Thai headline/company fixtures and keyboard navigation.
- [ ] Implement a coherent token scale using existing palette/fonts, readable secondary text, consistent controls/focus/selected states, and content-safe navigation with safe-area padding. Use one shared spacing/grid system; do not hide overflow to mask layout bugs.
- [ ] Refine auth so the real form and recovery steps lead. Replace empty decorative preview/chart content with factual product copy. Refine overview so news is the largest primary block, selected-company/source counts are secondary and the empty-watchlist state has a working add action.
- [ ] Inspect actual screenshots at all widths, check contrast, and fix the batch of observed issues. Run Taste lint/inspect in app mode when available; record justified tool limitations rather than claiming the check passed.
- [ ] Run `npm run test:ui` and responsive browser coverage. Commit after navigation, auth and overview work at all widths.

### Task 3: Finish route states and complete regression evidence

**Files:** dist/app.js; dist/research-ui.js; dist/quotes-ui.js; dist/security-ui.js; dist/push-ui.js; related CSS; test/research-browser.mjs; test/security-browser.mjs; test/login-otp-browser.mjs; test/pwa.mjs; test/responsive-browser.mjs; .github/workflows/test.yml; DESIGN.md; docs/FREE_CLOUD.md.

**Interfaces:** Retain current backend JSON and DOM action contracts. Show errors/availability from existing endpoints, with UI-only wording for free-host sleep/SMTP limitations sourced from the deployment configuration rather than exposing credentials.

- [ ] Add tests for slow/error/empty news, stale price timestamp, missing AI key, failed preference save preserving input, expired sessions clearing private UI, all More destinations and unconfigured email/Push controls. Test actual known behavior, not assertions that merely repeat new markup.
- [ ] Apply the spec's per-route priorities to news, following, search, AI, sources and settings. Keep source and time next to each claim; visually distinguish AI summary from experimental trend. Preserve the most useful controls near the relevant content.
- [ ] Align loading/disabled/error/success controls; keep submitted values on network failure. Show SMTP unavailable on the free deployment and paused background notifications in documentation/settings without claiming guaranteed delivery.
- [ ] Run the full relevant gate: `npm test`, `npm run test:ui`, `npm run test:research-ui`, `npm run test:security-ui`, `npm run test:login-ui`, `npm run test:pwa`, `npm run test:users`, and responsive coverage. Fix observed failures; upload screenshots as CI artifacts if local browser infrastructure is unavailable.
- [ ] Compare before/after at every width, run the configured icon/assets/CSP checks, update DESIGN.md from final tokens/behavior and summarize actual validation/remaining service setup in the PR. Commit.

## Plan handoff

The cloud and UI plans can be reviewed separately. Implement the database/cloud plan through its tested local staging first, then the UI plan, then publish the combined reviewed build. Recommended execution is Native: one implementer in this session with a fresh final reviewer, because database async changes cross most existing services and should remain coherent before UI regressions are evaluated. Public deployment/credentials remain the final account-dependent step.
