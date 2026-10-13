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

}

/** Test surface: pure parsing pieces, importable from Node without a runtime. */
export const __test = { parseSkillFile, unquoteScalar, collectCandidates, BLOCK_SCALAR_RE, SKILL_NAME_RE }
