/**
 * dsh-general-agentics — host half.
 *
 * Two jobs:
 *
 *   1. Skill provider (the @deepseek-ai/dsh-skill-office pattern): every
 *      `<package>/skills/<name>/SKILL.md` ships with this bundle and is
 *      registered through `ctx.skills.registerProvider()` as a bundled
 *      provider — visible to every session in the profile, upgraded together
 *      with the package, and removable by disabling this row. No files are
 *      copied into user directories.
 *
 *   2. Loader seat for the browser half: `dsh-client-modules` discovers
 *      browser bundles by scanning ACTIVE Loader entries — an entry whose
 *      package declares `dsh.client` is what puts `lib/client.js` into
 *      `window.__DSH_BOOT__` and behind `/plugins/<id>/client.js`.
 *
 * The bundle's MCP pre-configuration lives in cordis.patch.yml (one
 * @deepseek-ai/dsh-mcp-client row per server), not in code.
 */

import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import { prerequisiteItems } from './health.mjs'
import { fileURLToPath } from 'node:url'

/** Loader entry / diagnostic name. */
export const name = 'general-agentics'

/** The skill registry service must exist before we register the provider. */
export const inject = ['skills']

/**
 * BUNDLED_SKILL_RANK from @deepseek-ai/dsh-skill (packages/skill/skill/src/
 * index.ts:27). Hardcoded to keep this package dependency-free; bundled
 * skills are meant to lose against user-level overrides anyway.
 */
const BUNDLED_SKILL_RANK = 600

/** Kebab-case skill name grammar enforced by the skill system. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Parse one SKILL.md. Frontmatter is restricted to single-line scalars
 * Parse one SKILL.md. Dependency-free by design; understands the subset of
 * YAML the skill ecosystem actually uses: single-line scalars (quoted or
 * plain), block scalars (`|`/`>` with chomping indicators), comment and list
 * lines (list-valued fields other than name/description are tolerated and
 * skipped).
 * @param {string} raw - full file text.
 * @param {string} path - file path for error messages.
 * @returns {{ meta: Record<string, string>, content: string }} parsed skill.
 */
/** Strip one pair of matching surrounding quotes from a scalar value. */
function unquoteScalar(value) {
	const t = value.trim()
	if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
		return t.slice(1, -1)
	}
	return t
}

const BLOCK_SCALAR_RE = /^[|>][+-]?$/

function parseSkillFile(raw, path) {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
	if (frontmatter?.[1] === undefined) {
		throw new Error(`general-agentics: ${path} has no YAML frontmatter`)
	}
	const meta = {}
	let blockKey = null
	let blockFolded = false
	let blockLines = []
	const flushBlock = () => {
		if (blockKey === null) return
		const parts = blockLines.map((l) => l.trim()).filter((l) => l !== '')
		meta[blockKey] = (blockFolded ? parts.join(' ') : parts.join('\n')).trim()
		blockKey = null
		blockLines = []
	}
	for (const line of frontmatter[1].split(/\r?\n/)) {
		if (blockKey !== null) {
			// Inside a block scalar: indented (or blank) lines continue it;
			// a column-0 key ends it (fall through to normal handling).
			if (/^[ \t]/u.test(line) || line.trim() === '') {
				blockLines.push(line)
				continue
			}
			flushBlock()
		}
		if (line.trim() === '' || line.trim().startsWith('#')) continue
		if (/^-\s/u.test(line.trim())) continue // list member of a tolerated field
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
		if (kv === null) continue // tolerate unrecognized shapes
		const value = kv[2].trim()
		if (value === '') continue // key with no value (e.g. list-valued field header)
		if (BLOCK_SCALAR_RE.test(value)) {
			blockKey = kv[1]
			blockFolded = value.startsWith('>')
			blockLines = []
			continue
		}
		meta[kv[1]] = unquoteScalar(value)
	}
	flushBlock()
	if (typeof meta.name !== 'string' || !SKILL_NAME_RE.test(meta.name)) {
		throw new Error(`general-agentics: ${path} frontmatter has no kebab-case name`)
	}
	if (typeof meta.description !== 'string' || meta.description.length === 0) {
		throw new Error(`general-agentics: ${path} frontmatter has no description`)
	}
	return { meta, content: raw.slice(frontmatter[0].length).trim() }
}

/**
 * Collect the bundled skill candidates from this package's skills/ directory.
 *
 * One malformed skill must never take the bundle down. A throw here escapes
 * apply(), the Loader entry fails to activate, and a failed required entry
 * stops the whole app (docs/ops-lessons.md rule 5). The platform's own
 * provider warns and skips instead (dsh-skill-filesystem lib/index.js:682
 * "frontmatter requires name and description", :686 "invalid skill name"),
 * so this matches that contract: skip the skill, keep the bundle alive.
 *
 * Measured against the 215 real skills on the maintainer's machine, 6 (2.8%)
 * are rejected by the platform's own kebab-case name rule — under the old
 * throwing behaviour any one of them vendored into skills/ would have
 * prevented the app from starting.
 *
 * @param {string} root - absolute path to the skills directory.
 * @param {(message: string) => void} warn - diagnostic sink for skipped skills.
 * @returns {Array<object>} provider candidates for the skill registry.
 */
function collectCandidates(root, warn) {
	const candidates = []
	for (const entry of readdirSync(root).sort()) {
		const directory = join(root, entry)
		if (!statSync(directory).isDirectory()) continue
		const path = join(directory, 'SKILL.md')
		let raw
		try {
			raw = readFileSync(path, 'utf8')
		} catch {
			continue // not a skill directory (README notes, assets, …)
		}
		let meta
		let content
		try {
			({ meta, content } = parseSkillFile(raw, path))
		} catch (error) {
			// parseSkillFile already prefixes its own messages; warn() adds the
			// bundle prefix, so drop the inner one rather than print it twice.
			const reason = String(error.message).replace(/^general-agentics:\s*/u, '')
			warn(`skill "${entry}" ignored: ${reason}`)
			continue
		}
		if (meta.name !== entry) {
			// The platform keys a skill by its frontmatter name and does not
			// require that name to match its directory, so neither do we: keep
			// the declared name and stay compatible with a user-level copy of
			// the same skill (which would win on rank anyway).
			warn(`skill "${entry}": frontmatter name "${meta.name}" differs from its directory`)
		}
		candidates.push({
			name: meta.name,
			description: meta.description,
			invocation: { modelInvocable: true, userInvocable: true },
			provider: 'general-agentics',
			source: 'bundled',
			rank: BUNDLED_SKILL_RANK,
			resourceBase: { kind: 'directory', path: directory },
			locator: path,
			/** Carried for the model-facing catalog; unused by get(). */
			_content: content,
		})
	}
	return candidates
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings panel support: one HTTP endpoint the browser half reads.
//
// The bundle ships thirteen third-party plugins, and before this existed a user
// had no way to see what was inside it, which of those plugins were actually
// installed, or whether a newer release existed. The pattern is the one
// @michengai/dsh-agency-agents uses: the host half registers an exact route on
// the host web server (ctx.get('webServer').register), the browser half renders
// a `settings.section` panel and calls it.
//
//   GET  ?plugins=1  → bundle identity, latest version, per-plugin matrix, skills
//   POST             → ask the plugin manager to install <pkg>@latest
//
// Read-only until POST; every registry call is short-timeout and failure is
// reported as "unknown" rather than an error, because a deployment may be
// offline and the panel must still render.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the browser half looks for status and update. */
export const STATUS_ENDPOINT = '/api/general-agentics/status'

const manifestRequire = createRequire(import.meta.url)

/** This package's own manifest, or an empty object when unreadable. */
export function readOwnManifest(root = fileURLToPath(new URL('..', import.meta.url))) {
	try {
		return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	} catch {
		return {}
	}
}

/**
 * Installed version of a dependency, resolved FROM THE PROFILE.
 *
 * Anchoring the require at the profile matters: with a `link:` install Node
 * resolves this module to its real path outside the profile, so walking up from
 * here would miss the profile's node_modules entirely and every plugin would
 * look uninstalled.
 */
export function installedVersion(name, cwd = process.cwd()) {
	try {
		return createRequire(join(cwd, 'package.json'))(`${name}/package.json`).version
	} catch {
		return undefined
	}
}

/** Minimal semver comparison: -1 / 0 / 1. Prerelease sorts below its release. */
export function compareSemver(a, b) {
	const parse = (value) => String(value).split('-')
	const [coreA, preA] = parse(a)
	const [coreB, preB] = parse(b)
	const numsA = coreA.split('.').map(Number)
	const numsB = coreB.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		const x = numsA[i] ?? 0
		const y = numsB[i] ?? 0
		if (x !== y) return x < y ? -1 : 1
	}
	if (preA === undefined && preB === undefined) return 0
	if (preA === undefined) return 1
	if (preB === undefined) return -1
	return comparePrerelease(preA, preB)
}

/**
 * Prerelease identifiers compare field by field, numerically when both are
 * digits: `alpha.2 < alpha.10`. A plain string compare gets that backwards,
 * which matters here because this bundle's own versions are `alpha.N`.
 */
function comparePrerelease(a, b) {
	const left = a.split('.')
	const right = b.split('.')
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const x = left[i]
		const y = right[i]
		if (x === undefined) return -1
		if (y === undefined) return 1
		const numericX = /^[0-9]+$/u.test(x)
		const numericY = /^[0-9]+$/u.test(y)
		if (numericX && numericY) {
			const delta = Number(x) - Number(y)
			if (delta !== 0) return delta < 0 ? -1 : 1
			continue
		}
		// numeric identifiers always sort below alphanumeric ones
		if (numericX !== numericY) return numericX ? -1 : 1
		if (x !== y) return x < y ? -1 : 1
	}
	return 0
}

/** Profile name the CLI expects (`.../profiles/desktop` → `desktop`). */
export function profileNameFromDir(dir) {
	if (typeof dir !== 'string') return undefined
	const base = dir.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop()
	return base === undefined || base === '' ? undefined : base
}

/**
 * Where the profile lives. process.cwd() is NOT reliable: the desktop app
 * spawns its host with the profile as cwd, but a CLI launch keeps whatever
 * directory the user started it from (measured: `/private/tmp`), which would
 * make every curated plugin look uninstalled. So: scan argv for the profile
 * (the desktop app passes the directory as a positional, the CLI passes
 * `--profile <name>`), then fall back to cwd only when it really is a profile.
 *
 * @param {object} [options] - injectable for tests.
 * @returns {{dir: string, name: string, source: string}|undefined}
 */
export function resolveProfile({
	argv = process.argv,
	env = process.env,
	cwd = process.cwd(),
	exists = (path) => { try { statSync(path); return true } catch { return false } },
	readFile = (path) => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
} = {}) {
	const fromPath = (dir) => (dir === undefined ? undefined : { dir, name: profileNameFromDir(dir), source: 'argv' })
	// 1. an absolute positional that names a profile directory
	for (const arg of argv) {
		if (typeof arg !== 'string' || !/[\\/]profiles[\\/][^\\/]+$/u.test(arg)) continue
		const dir = arg.replace(/[\\/]+$/u, '')
		if (exists(dir)) return { ...fromPath(dir), source: 'argv-path' }
	}
	// 2. `--profile <name>` (or --profile=<name>)
	const index = argv.findIndex(arg => arg === '--profile')
	const inline = argv.find(arg => typeof arg === 'string' && arg.startsWith('--profile='))
	const name = inline !== undefined ? inline.slice('--profile='.length) : (index >= 0 ? argv[index + 1] : undefined)
	if (typeof name === 'string' && name !== '' && !name.startsWith('-')) {
		const home = env.DSH_HOME ?? join(env.HOME ?? '', '.dsh')
		return { dir: join(home, 'profiles', name), name, source: 'argv-profile' }
	}
	// 3. cwd, but only when it actually holds a profile manifest
	const manifest = readFile(join(cwd, 'package.json'))
	if (manifest !== undefined) {
		try {
			if (JSON.parse(manifest)?.dsh?.profile !== undefined) {
				return { dir: cwd, name: profileNameFromDir(cwd), source: 'cwd' }
			}
		} catch { /* not a profile manifest */ }
	}
	return undefined
}

/** The profile's declared spec for a package, plus whether it is a dev install. */
export function profileSpecFor(cwd, packageName) {
	try {
		const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
		const spec = manifest.dependencies?.[packageName]
		const text = typeof spec === 'string' ? spec : ''
		return {
			dir: cwd,
			profile: manifest.name,
			spec,
			/** Everything the profile installs itself — a curated plugin listed
			 *  here is ALSO provided by this bundle, which is the one case where
			 *  the ga- row ids are load-bearing. */
			dependencies: Object.keys(manifest.dependencies ?? {}),
			/** `link:` — a live development checkout. */
			devInstall: text.startsWith('link:'),
			/** `file:` — a frozen tarball/directory snapshot. */
			frozenInstall: text.startsWith('file:'),
		}
	} catch {
		return { dir: cwd, profile: undefined, spec: undefined, devInstall: false }
	}
}

/** Latest published version, or undefined when the registry cannot be reached. */
export async function fetchLatestVersion(name, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
	try {
		const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (response.ok !== true) return undefined
		const body = await response.json()
		return typeof body.version === 'string' && body.version !== '' ? body.version : undefined
	} catch {
		return undefined
	}
}

/** Stable ordering so the panel does not reshuffle between reloads. */
const compareVersions = (a, b) => (a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a.localeCompare(b, 'en'))

/** Skill names as the registry will see them; a skill that cannot be parsed is
 *  skipped by collectCandidates itself (warn-and-skip), so this never throws. */
function listSkillNames(root) {
	try {
		return collectCandidates(root, () => {}).map(candidate => candidate.name)
	} catch {
		return []
	}
}

/**
 * Everything the settings panel shows. `includePlugins` adds one registry
 * lookup per curated plugin — the panel asks for it explicitly so the first
 * paint stays fast and an offline deployment still renders.
 */
export async function buildStatus({
	root = fileURLToPath(new URL('..', import.meta.url)),
	cwd = process.cwd(),
	includePlugins = false,
	fetchImpl = fetch,
	resolve = resolveProfile,
} = {}) {
	const pkg = readOwnManifest(root)
	const located = resolve()
	const profile = profileSpecFor(located?.dir ?? cwd, pkg.name)
	const curated = Object.entries(pkg.dependencies ?? {})
		.map(([plugin, spec]) => ({ name: plugin, spec, installed: installedVersion(plugin, located?.dir ?? cwd), latest: undefined }))
		.sort((a, b) => a.name.localeCompare(b.name, 'en'))

	const direct = new Set(profile.dependencies ?? [])
	for (const plugin of curated) plugin.alsoDirect = direct.has(plugin.name)

	const latest = await fetchLatestVersion(pkg.name, { fetchImpl })
	if (includePlugins) {
		const results = await Promise.all(curated.map(plugin => fetchLatestVersion(plugin.name, { fetchImpl })))
		curated.forEach((plugin, index) => {
			const published = results[index]
			plugin.latest = published
			plugin.updateAvailable = published !== undefined && plugin.installed !== undefined &&
				compareSemver(published, plugin.installed) > 0
		})
	}
	return {
		package: pkg.name,
		current: pkg.version,
		latest,
		updateAvailable: latest !== undefined && pkg.version !== undefined && compareSemver(latest, pkg.version) > 0,
		localAhead: latest !== undefined && pkg.version !== undefined && compareSemver(pkg.version, latest) > 0,
		profile: { ...profile, name: located?.name, source: located?.source },
		updateCommand: `dsh plugin --profile ${located?.name ?? '<profile>'} add ${pkg.name}@latest`,
		skills: listSkillNames(join(root, 'skills')).sort(),
		// What an npm install cannot provide: tools on PATH, credentials, a free port.
		prerequisites: prerequisiteItems(curated.map(plugin => plugin.name)),
		curated,
	}
}

/** Serve the endpoint on the host web server, when the profile has one. */
export function registerStatusEndpoint(ctx, options = {}) {
	const server = ctx.get?.('webServer') ?? ctx.webServer
	if (typeof server?.register !== 'function') return false
	const write = (response, status, payload) => {
		const body = JSON.stringify(payload)
		response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
		response.end(body)
	}
	const mount = () => server.register({
		kind: 'exact',
		path: STATUS_ENDPOINT,
		handler: async (request, response) => {
			const url = new URL(request.url ?? STATUS_ENDPOINT, 'http://localhost')
			try {
				if (request.method === 'GET' || request.method === 'HEAD') {
					const status = await buildStatus({
						...options,
						includePlugins: url.searchParams.get('plugins') === '1',
					})
					write(response, 200, status)
					return
				}
				if (request.method === 'POST') {
					const manager = ctx.get?.('pluginManager') ?? ctx.pluginManager
					const pkg = readOwnManifest(options.root).name
					if (pkg === undefined) return write(response, 500, { ok: false, error: 'manifest unreadable' })
					if (typeof manager?.installBundle !== 'function') {
						const status = await buildStatus(options)
						write(response, 200, {
							ok: false,
							manual: true,
							command: status.updateCommand,
							reason: 'this profile exposes no plugin manager; run the command manually',
						})
						return
					}
					// The manager's installBundle refuses a package that is already a
					// dependency ("already-installed", raised whenever HMR is present) and
					// exposes no update call, so an update is remove + install. If the
					// install then fails, put the previous version back rather than
					// leaving the profile without its bundle.
					const status = await buildStatus(options)
					if (status.latest === undefined) {
						write(response, 200, { ok: false, code: 'registry-unreachable', manual: true, command: status.updateCommand })
						return
					}
					if (status.latest === status.current) {
						write(response, 200, { ok: false, code: 'already-current', manual: false })
						return
					}
					const previous = status.current
					let removed
					try {
						removed = await manager.removeBundle(pkg)
					} catch (error) {
						write(response, 500, { ok: false, code: error?.code ?? 'remove-failed', error: String(error?.message ?? error) })
						return
					}
					let result
					try {
						result = await manager.installBundle(`${pkg}@${status.latest}`)
					} catch (error) {
						result = { application: 'failed', error: { code: error?.code, diagnostic: String(error?.message ?? error) } }
					}
					// The manager decides "applied" by whether every entry activated on the
					// reload. A remove+install swap briefly runs two copies of a plugin, so
					// a transient "duplicate route" turns that verdict into "failed" even
					// when the new version is installed. Trust what is actually on disk.
					const applied = ['applied', 'restart-required', 'overridden'].includes(result?.application)
					const installedNow = installedVersion(pkg, status.profile.dir)
					const moved = installedNow !== undefined && installedNow === status.latest
					if (applied || moved) {
						write(response, 200, {
							ok: true,
							application: result?.application,
							restartRequired: true,
							changed: result?.changed,
							version: installedNow ?? status.latest,
							previous,
							removed: removed?.application,
							warnings: applied ? undefined : (result?.error?.diagnostic ?? undefined),
						})
						return
					}
					let restored
					try {
						restored = await manager.installBundle(`${pkg}@${previous}`)
					} catch {
						restored = { application: 'failed' }
					}
					const failure = result?.error
					write(response, 500, {
						ok: false,
						application: result?.application,
						restartRequired: false,
						changed: result?.changed,
						code: failure?.code,
						error: failure?.diagnostic ?? failure?.message ?? (typeof failure === 'string' ? failure : undefined) ?? result?.packageResult?.output,
						restored: ['applied', 'restart-required', 'overridden'].includes(restored?.application),
					})
					return
				}
				write(response, 405, { ok: false, error: `method not allowed: ${request.method}` })
			} catch (error) {
				write(response, 500, { ok: false, error: String(error?.message ?? error) })
			}
		},
	})
	if (typeof ctx.effect === 'function') {
		ctx.effect(() => mount(), 'general-agentics: settings endpoint')
		return true
	}
	mount()
	return true
}

/**
 * Register the bundled skills. Mirrors @deepseek-ai/dsh-skill-office's
 * apply(): static candidates read at activation, served by a named provider.
 * @param {object} ctx - Context carrying the skill registry.
 */
export function apply(ctx) {
	const root = fileURLToPath(new URL('../skills/', import.meta.url))
	if (!isAbsolute(root)) throw new Error('general-agentics: skills root must be absolute')
	statSync(root) // fail loud on a broken install

	// Same diagnostic channel the platform's skill provider uses; stderr
	// fallback keeps the collector exercisable outside a runtime.
	const sink = typeof ctx?.logger?.warn === 'function'
		? (message) => ctx.logger.warn(message)
		: (message) => process.stderr.write(`${message}\n`)
	const warn = (message) => sink(`general-agentics: ${message}`)

	const candidates = collectCandidates(root, warn)
	const provider = {
		name: 'general-agentics',
		list: () => Promise.resolve(candidates.map(({ _content, ...summary }) => summary)),
		async get(candidate) {
			const found = candidates.find(c => c.name === candidate.name)
			if (found === undefined) throw new Error(`general-agentics: unknown skill ${candidate.name}`)
			const { _content, ...summary } = found
			return { ...summary, content: _content }
		},
	}
	ctx.skills.registerProvider(() => provider)

	// Settings panel endpoint. A dynamic injection rather than a static
	// `inject` entry: a profile without a web server must still get the skills
	// provider above, and this callback runs as soon as — or immediately when —
	// the service exists.
	const mountEndpoint = (scope) => {
		try {
			if (!registerStatusEndpoint(scope)) warn('webServer has no register(); settings panel endpoint not mounted')
		} catch (error) {
			warn(`settings panel endpoint failed: ${String(error?.message ?? error)}`)
		}
	}
	if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountEndpoint)
	else mountEndpoint(ctx)

}

/** Test surface: pure parsing pieces, importable from Node without a runtime. */
export const __test = {
	parseSkillFile,
	unquoteScalar,
	collectCandidates,
	buildStatus,
	profileSpecFor,
	installedVersion,
	compareSemver,
	resolveProfile,
	profileNameFromDir,
	fetchLatestVersion,
	STATUS_ENDPOINT,
	BLOCK_SCALAR_RE,
	SKILL_NAME_RE,
}
