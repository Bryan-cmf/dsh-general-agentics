# Changelog

Every published version of the bundle. The package is a wiring layer: it ships
brand, skills and a settings panel itself, and declares the curated plugins as
dependency ranges that the profile's package manager resolves.

## 0.2.0-alpha.24 (unreleased)

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
