# Changelog

## 0.3.0-alpha.3 (unreleased)

- **Taste defaults ride the install (zero boot warnings).** The curated-plugin
  config overrides that used to sit in the bundle's overlay warned on every
  boot while their target plugins were absent (measured: `patch: entry
  "dsh-context" not found` ×3, and `disabled:` does not silence it). They are
  declared per catalog entry now and written into the PROFILE's own patch layer
  by the install action itself (`applyTaste`), which also replaces a fresh
  profile's trailing `[]` carrier instead of appending after it (invalid YAML,
  measured). Fresh install and post-install boots: 0 warnings.
- Migration cleanup: the desktop profile's own patch file carried four stale
  rows targeting the retired `ga-*` ids; removed (backed up first).

## 0.3.0-alpha.2


## 0.3.0-alpha.1 (unreleased)

**The bundle stops carrying third-party plugins.** Since the first release the
curated set rode along as package.json dependencies; that made every upstream
release our floor to raise and republish, every upstream major a decision we had
to make for every user, and the overlay a verbatim copy of eleven plugins' patch
rows that drifted silently on each of their releases. The design is now what it
should have been:

- the bundle ships **the front-end design, the 14 skills, the ga-status MCP
  server and the two first-party plugins** (dsh-comments, dsh-promptimizer)
- eleven third-party plugins move to a **curated marketplace catalog**
  (lib/catalog.mjs) rendered in the panel: one-click install, one-click update.
  An install is the user's own direct row — their plugin's own patch layer
  activates, and updates are their click, not our release
- the overlay carries only what the bundle owns; taste defaults for catalog
  plugins are top-level config overrides targeting THEIR row ids, inert until
  the plugin is installed
- the panel's Plugins tab is now two sections — *Included with this bundle* and
  *Curated marketplace* — with `installed` meaning ACTIVATED (a direct
  dependency), not "files happen to be on disk"; leftover files from the
  bundle era surface as a residual note instead of masquerading as installed
- health: a catalog entry that is not installed is a choice, not a deduction;
  missing/duplicate checks now apply to the included set only
- `POST action=plugin&pkg=<name>` backs the buttons: manager.installBundle on a
  catalog name, version verified from disk, recorded in last-result like every
  other write
- **Install all / Update all**: one button over the marketplace section walks
  the catalog sequentially (the host's write lock would refuse a parallel
  fan-out anyway), shows `3/11…` progress, tolerates per-plugin failure, and
  ends with an `ok N, failed M` summary — the "install everything this bundle
  used to carry" path is one click without putting it in the boot path
- dsh-im specifically: install from the catalog and you get 5.2.0 (the major
  the old floor blocked); the report and the badge no longer call it an update
  the bundle cannot deliver

Migration for an existing profile: update the bundle, then install what you
want from the marketplace tab — dsh-im first if you were seeing its errors.

## 0.2.0-alpha.33 (2026-10-20)

## 0.2.0-alpha.33 (unreleased)

- **Range-aware plugin updates (S22).** A curated plugin's "update available"
  now respects the range this bundle declares: a registry release outside it
  (dsh-im 5.2.0 under `^4.39.0`, say) is shown as "Newer {v} (out of range)"
  with the range in the row and a copyable floor-bump command — because the
  bundle's own update can never deliver it, and installing it directly is what
  the health card flags as a duplicate. The direct-install button is gone from
  curated rows; the missing-plugin hint now re-adds the bundle instead of the
  single plugin, for the same reason.
- **Diagnostics behind the panel token (S24).** `?diagnostics=1` is a POST
  carrying `x-ga-csrf` (the report fingerprints the deployment: inventory,
  versions, prerequisites). A plain GET no longer returns it. The manual
  update command names the profile only for same-origin readers; curl without
  fetch metadata gets `--profile <profile>`.
- **Layout canaries (S25).** `__DSH_GA_DIAG__.heroMatches` and
  `.compactMatches` count what the two `:has()` selectors actually match, so a
  hashed-class change upstream shows up as a silent zero instead of a mystery
  fallback.
- **`npm run review` prints the upstream freshness report (S26)** — advisory,
  never a failure: an upstream release is a decision, not a breakage.
- **CHANGELOG.md ships in the tarball (S28)** and dated entries replace the
  "(unreleased)" markers that had drifted behind what is actually on npm.


Every published version of the bundle. The package is a wiring layer: it ships
brand, skills and a settings panel itself, and declares the curated plugins as
dependency ranges that the profile's package manager resolves.

## 0.2.0-alpha.32 (2026-10-20)

- **The composer compaction actually wins now.** Alpha.31's row rules were
  overridden by stylesheets that load after ours (the Experts chip stayed 83px
  because agency-agents sets font-size: 13px), so the toolbar still wrapped.
  The cross-plugin rules carry `!important`; measured at 360/390px: Experts is
  30px and tools/trailing share one row.

## 0.2.0-alpha.31 (2026-10-20)

- **The composer toolbar fits one row on phones again.** With the curated
  plugins' controls the row needs ~373px, so at 360-430px it wrapped into two
  rows with the second one starting mid-width. Under 460px the Optimize strength
  caret is hidden (`!important` — its inline `display:flex` beats a plain rule),
  the Experts chip becomes icon-only (`font-size: 0`; its label is a bare text
  node), and the row's padding/gaps tighten; under 380px the group gaps tighten
  further. Measured at 360/390/430px: tools and trailing share one row.

## 0.2.0-alpha.30 (2026-10-19)

- **Composer stays one row on a 360px phone**: the optimizer's strength caret is
  hidden under 420px (measured: the trailing group was 162px against the 135px
  that fit), so add-files/access-mode and optimize/model/send no longer split
  into two lines. Floor raised to dsh-promptimizer `^0.1.4`.

## 0.2.0-alpha.29 (2026-10-19)

- **Phone-width controls**: the composer's Optimize control drops its label
  below 520px (the ✨ and its tooltip remain), and the comments dock's status
  row keeps only its icons (🏷 ☁ ⤴ ➤). Floors raised to dsh-promptimizer
  `^0.1.3` and dsh-comments `^0.6.1`.


- **Hero hierarchy**: the official hero renders the brand slot and its headline
  in one 26px flex row, so "General Agentics Powered by DeepSeek Harness" read as
  a single long sentence. The brand now sits on its own line and the attribution
  (with the Preview pill) is a 12.5px muted footnote below it — starting on the
  centre line, so it sits under the brand's lower right; below 640px it falls
  back to centred because a 50% start would run past the edge. Reached
  through `:has()` on a stable `data-ga-hero` hook because the shell's class
  names are hashed; browsers without `:has()` keep the original row.
- **Fixed `plugins.detail.badge`**: it is a list slot, and our registration used
  `priority` without an `id`. It threw (`list slot … requires options.id`) when a
  plugin detail page rendered, so the GA badge never appeared. Probe P17 now
  refuses a list-slot registration without an id.

## 0.2.0-alpha.28 (2026-10-18)

- **dsh-comments 0.6.0**: the comments plugin is renamed end to end (data,
  routes, localStorage keys, DOM attributes, logs), with the old marks file and
  keys migrated automatically. This release raises the floor to `^0.6.0` so a
  fresh install gets the renamed plugin rather than the old one.

## 0.2.0-alpha.27 (2026-10-18)

- **Visible without opening Settings**: a status pill in the sidebar footer
  ("Update available: 0.2.0-alpha.30", or "N need attention") that opens the
  bundle page, plus a leading `●` in the tab title. Both respect the quiet
  window. Registering into a **list** slot needs `id` + `order`, not `priority`
  — with `priority` the entry silently never rendered (probe P16 and a lesson).
- **Fixed a self-inflicted P0**: the title rewrite assigned `document.title`
  unconditionally, the head observer fired on that write, and the page spun up
  22 browser processes at ~800% CPU without ever loading. Both title writes now
  compare before assigning; probe P15 guards it.
- **Keyboard and pointer affordances**: the tab list responds to ←/→, controls
  show a hover background and a focus outline, and the skills search clears on
  Esc.

## 0.2.0-alpha.26 (folded into alpha.27 — never published separately)

- **Tabs**: the panel had grown to ten stacked cards; it is now four tabs —
  Status / Plugins / Skills / Settings — with `role=tablist`/`tab`/`tabpanel`,
  `aria-selected`, and a sticky header that keeps the version, health and
  "Check again" visible while scrolling.
- **One first-run card**: the "what this bundle gives you" card and the
  preferences wizard were two cards saying overlapping things. They are now one
  card that sets language, accent and quiet hours and then goes away.
- **Live language**: switching between 中文 and English re-renders the panel in
  place — no reload, no lost tab, filter or search state.
- **Skills tab**: search across skill names and descriptions and a collapsed
  view (six rows, "Show all 14"), because fourteen full descriptions was a wall
  of text.
- **Saved feedback**: settings writes flash a short "Saved" line announced via
  `aria-live`, and Esc clears the skills search.
- The i18n coverage test caught a `t('tab_' + tab)` concatenation that made a
  key invisible to it; the label is now a literal lookup table.

## 0.2.0-alpha.25 (folded into alpha.27 — never published separately)

- **Client tests (S16)**: `test/client-panel.test.mjs` renders the panel, the
  sidebar dot and the plugin badge through a minimal fake DOM and hooks runtime —
  nine tests covering the layout, the Try seeding, accent/quiet writes, the
  first-run card, diagnostics copy and the badge states, with a mutation check to
  prove they fail when the behaviour changes.
- **Second audit (S13–S21)**: switching accents disposes the previous theme
  layer; a restore only counts once the version is on disk; failed restores are
  recorded; concurrent writes are serialised (second gets 409 `busy`);
  `installedVersion` reads the file instead of `require` (module cache made a
  swap invisible); `npm run ci` and `prepublish-check` now run the probes.
  The language source is observable (`window.__GA_LOCALE_SOURCE__`) and a live
  run confirmed `service`, i.e. D3 really uses the app's locale.
- **Review loop**: `npm run review` runs fourteen adversarial probes (rollback restore,
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
