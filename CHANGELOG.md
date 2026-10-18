# Changelog

Every published version of the bundle. The package is a wiring layer: it ships
brand, skills and a settings panel itself, and declares the curated plugins as
dependency ranges that the profile's package manager resolves.

## 0.2.0-alpha.25 (unreleased)

- **Review loop**: `npm run review` runs ten adversarial probes (rollback restore,
  stale record, redaction, disposer, locale, preview gating, badge refresh, usage
  bounds, failure recording, badge fallback); process and severity rubric in
  `docs/review-loop.md`, findings ledger in `docs/review-findings.md`.
- **Fixes from the first audit (S1–S10)**: a failed rollback restores the previous
  version; a stale rollback record is refused with 409; diagnostics and the status
  payload redact `$HOME`; accent overrides hand their disposer back; the locale is
  resolved through `ctx.get('locale')`; usage is byte-bounded and labelled
  `all-workspaces`; failures are recorded for the next report; confirm is disabled
  while the preview loads; the i18n test covers template keys; the quiet-hours
  hint names the server clock and the sidebar dot refreshes after a settings write.

- **Update preview (A1)**: before installing, the panel asks the registry for the
  target manifest and shows exactly which dependency ranges move
  (`browser-use ^0.6.2 → ^0.7.0`), plus the target's `engines.dsh`. New endpoint
  mode `GET /api/general-agentics/status?preview=1`.
- **Brand accents (D1)**: four presets (indigo / teal / amber / rose), each with
  light and dark values, applied through the theme service and stored in
  `settings.json`. The panel recolours immediately; the choice survives restarts.
- **First-run wizard (D2)**: a dismissible card on first open that sets language,
  accent and quiet hours in one place, then goes away (localStorage flag).
- **App locale (D3)**: the client half now asks the app's locale service for the
  active language instead of only sniffing `navigator.language`, guarded because
  `locale` is not in the bundle's inject list (an unguarded read took the whole
  client half down once — the E2E caught it and it is now in ops-lessons).
- **Health score (C3)**: `healthScore()` turns the status payload into 0-100 plus
  the exact deductions (missing plugin -12 each, duplicate install -8, missing
  prerequisite -10, behind -2, all capped). Shown as a chip in the panel header
  and as a list in the health card; pure function, unit tested including the
  clamp at zero.
- **Diagnostics bundle (C1)**: `GET /status?diagnostics=1` returns paste-ready
  Markdown — bundle/profile, health and deductions, the curated matrix with
  flags, prerequisites, settings, last write, and usage. A "Copy diagnostics"
  button puts it on the clipboard, so a bug report no longer needs an interview.
- **Usage insights (C2, best-effort)**: `GET /status?usage=1` reads the newest
  twelve session logs (zstd, `tool/call` records only), counts tools and skill
  invocations, and renders "12 sessions scanned, 2143 tool calls" plus the skills
  used. Counts only — no message text leaves the host. Degrades to a stated
  reason when Node lacks zstd or the store is unreadable.
- **Skills browser (B1)**: the panel lists each bundled skill with its one-line
  description and a "Try" button that seeds the composer with
  `Use the "<skill>" skill for this task: `. The host now parses SKILL.md
  front-matter (`skillDetails` in the status payload) instead of shipping names
  only.
- **Capability map (B2)**: each START HERE card on the home surface names the
  bundled skills it draws on (`Skills: brainstorming · writing-plans …`), so the
  map from intent to skill is visible before the first message.
- **Plugin badge (B3)**: `plugins.detail.badge` gets a "GA curated" chip for the
  plugins this bundle curates. Honest limitation: the headless verification run
  could not reach the plugin detail pane (the SPA has no `/plugins` route and the
  sidebar's Plugins button opens Settings), so the badge is implemented and
  degrades to nothing when the subject is not curated, but it has not been seen
  rendered yet. Follow-up: confirm in the desktop app.
- **Sidebar update dot (A3)**: a 6px dot on the collapsed sidebar's toggle when an
  update is available (or something needs attention), with a tooltip naming the
  version. It is registered only when `globalThis.dshDesktop` is absent, so the
  desktop app keeps its own app-update indicator in that single slot.
- **Quiet hours (A3)**: the panel picks a quiet window (off / 22:00-08:00 /
  09:00-18:00); during it the dot stays hidden. Stored under
  `${DSH_HOME}/general-agentics/settings.json`, computed on the host so the
  wrap-around logic is unit-tested. New endpoint mode
  `POST /status?action=settings&quiet=night`.
- **One-click rollback (A2)**: every successful update records `from → to` under
  `${DSH_HOME}/general-agentics/update.json`; the panel then offers "Back to
  <version>" (with a confirmation). Rolling back flips the record, so it can be
  rolled forward again with the next update. New endpoint mode
  `POST /api/general-agentics/status?action=rollback`.

## 0.2.0-alpha.24

- Security: the update endpoint now requires a same-origin request carrying a
  per-process token issued by the status GET. A blind `curl`, a wrong token, a
  cross-site `Sec-Fetch-Site` or a foreign `Origin` is refused with 403 before
  anything is installed; verified against a live profile.
- Performance: the two `document.body` observers coalesce to one run per frame,
  and the hero-tagline rewrite now walks only the subtrees a mutation touched.
  Measured: 200 synchronous DOM mutations produce one tagline pass and one
  placement pass (previously one full-document walk per mutation). A new
  `window.__DSH_GA_DIAG__` counter makes that measurable.
- Loading: the panel paints from a cheap snapshot first, then fills the plugin
  matrix; registry answers are cached for 60s. Measured: matrix request
  0.337s → 0.002s on the second call. A skeleton renders while the first
  snapshot is in flight, and an unreachable registry is stated as such instead
  of claiming "latest" (13 rows say "Checking", none lie).
- `DSH_GA_REGISTRY_URL` selects the registry base, for mirrors and offline runs.
- Engineering: `npm run ci` runs the same gate as the GitHub Actions workflow;
  the workflow itself is staged at `ci/github-actions.yml` with enablement
  instructions (pushing `.github/workflows/` needs the token's workflow scope).
- Portability: the dsh-mobile companion row disables itself when its file is
  absent (isolated linker or an upstream layout change) instead of failing to
  import. A guard expression that does not parse is now a test failure.
- Health: prerequisites and duplicate installs are computed once in
  `lib/health.mjs` and shown in the panel, not only through the MCP tool.
- Panel: status-first layout — state chip, last-checked time, 需要注意 card,
  filter chips and search, expandable rows with copy/npm actions, update
  progress with elapsed time and `aria-live`.
- Internationalization: the panel renders in Chinese or English following the
  browser language (overridable), from two dictionaries with an identical key
  set; a structural test fails if a key is missing from either side or used
  without a translation.

## 0.2.0-alpha.23

- Status panel: progress feedback, real failure codes and diagnostics from the
  plugin manager, and a success verdict based on the version actually installed.

## 0.2.0-alpha.22

- The update button actually updates: install the exact version shown, remove +
  install (the manager has no update call), roll back on failure.

## 0.2.0-alpha.21

- Pick up browser-use 0.6.2 and cost-meter 1.8.36; document the exempted extras.

## 0.2.0-alpha.20

- Curate dsh-comments and dsh-promptimizer now that they are published.

## 0.2.0-alpha.19

- Add the two first-party tools with the versions that carry `engines.dsh`.

## 0.2.0-alpha.18

- Adapt to DSH 0.2.1-rc.2: its installation gate rejects plugins whose declared
  `engines.dsh` / `@deepseek-ai/dsh*` peers exclude the runtime, so the curated
  set moves to accepted versions and `engines.dsh` becomes `>=0.2.1-rc.2`.
