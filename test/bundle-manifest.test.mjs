/**
 * Structural invariants between package.json and cordis.patch.yml.
 *
 * DSH 0.2.1 added an installation gate: a plugin whose `engines.dsh` (or whose
 * `@deepseek-ai/dsh*` peer ranges) does not admit the runtime makes
 * `dsh plugin add` refuse the WHOLE installation and roll the profile back. So
 * a curated dependency that cannot be installed, or a row whose package is not
 * a dependency, breaks every user at install time rather than at boot.
 *
 * These checks are dependency-free on purpose: they run anywhere.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/** `- id: ga-x` + `name: <pkg>` pairs, quotes stripped, list items only. */
function curatedRows() {
	const rows = []
	for (const match of patch.matchAll(/^ {4}- id: (ga-[a-z0-9-]+)\n {6}name: ['"]?([^'"\n]+)['"]?$/gmu)) {
		rows.push({ id: match[1], name: match[2] })
	}
	return rows
}

test('every curated dependency has exactly one ga- row', () => {
	const rows = curatedRows()
	const byName = new Map()
	for (const row of rows) byName.set(row.name, [...(byName.get(row.name) ?? []), row.id])
	for (const dependency of Object.keys(manifest.dependencies)) {
		const ids = byName.get(dependency) ?? []
		assert.equal(ids.length, 1, `${dependency} should have exactly one ga- row, found ${ids.length}`)
	}
})

test('every ga- row names a curated dependency (or a subpath of one)', () => {
	for (const row of curatedRows()) {
		const base = row.name.startsWith('@')
			? row.name.split('/').slice(0, 2).join('/')
			: row.name.split('/')[0]
		assert.ok(base in manifest.dependencies, `${row.id} names ${row.name}, which is not a dependency`)
	}
})

test('row ids are unique and ga- prefixed', () => {
	const ids = curatedRows().map(row => row.id)
	assert.equal(new Set(ids).size, ids.length, `duplicate row ids: ${ids.join(', ')}`)
	for (const id of ids) assert.match(id, /^ga-/u)
})

test('the patch provides no upstream-shaped row ids for curated plugins', () => {
	// A row whose id equals the package's own patch id would collide when a user
	// also installs that plugin directly — the reason every curated row is ga-.
	for (const dependency of Object.keys(manifest.dependencies)) {
		const bare = dependency.startsWith('@') ? dependency.split('/')[1] : dependency
		const collides = new RegExp(`^ {4}- id: ${bare}$`, 'mu').test(patch)
		assert.equal(collides, false, `${bare} is inserted under its upstream id`)
	}
})

test('engines.dsh is declared and admits a prerelease runtime', () => {
	assert.equal(typeof manifest.engines?.dsh, 'string', 'engines.dsh must be declared for the 0.2.1 gate')
	assert.match(manifest.engines.dsh, /\d+\.\d+\.\d+/u)
	// `>=x` is the only shape that keeps admitting rc releases under
	// semver's includePrerelease, so refuse a capped range by accident.
	assert.doesNotMatch(manifest.engines.dsh, /<\d/u)
})

test('the bundle ships its skills, client half and MCP server', () => {
	assert.ok(manifest.dsh?.bundle?.patch, 'dsh.bundle.patch missing')
	assert.equal(manifest.dsh?.client?.platform, 'web')
	for (const file of ['lib/client.js', 'lib/index.js', 'mcp/ga-status-server.mjs', 'cordis.patch.yml']) {
		assert.ok((manifest.files ?? []).some(entry => entry === file || file.startsWith(`${entry}/`)), `${file} is not covered by files`)
	}
})

test('no !!js value starts with another tag character', () => {
	// `!!js !foo` makes YAML read a SECOND tag property and the whole overlay
	// fails to parse — the plugin manager then refuses the installation.
	for (const line of patch.split('\n')) {
		const match = /!!js\s+(\S)/u.exec(line)
		if (match !== null) assert.notEqual(match[1], '!', `YAML tag collision: ${line.trim()}`)
	}
})

test('the patch declares its own overlay shape only', () => {
	// every !!js expression must be a single-line scalar or an explicit block
	for (const line of patch.split('\n')) {
		if (!line.includes('!!js')) continue
		assert.doesNotMatch(line, /:\s+!!js\s*$/u, `empty !!js expression: ${line.trim()}`)
	}
})

test('every single-line !!js expression parses as JavaScript', () => {
	// A syntactically broken guard makes the row fail to activate at boot (and an
	// unquoted leading `!` breaks the YAML itself); both are cheap to catch here.
	let checked = 0
	for (const line of patch.split('\n')) {
		if (/^\s*#/u.test(line)) continue
		const match = /:\s+!!js\s+(?!>-)(.+)$/u.exec(line)
		if (match === null) continue
		const raw = match[1].trim()
		// Only strip quotes when the WHOLE value is quoted; an unquoted scalar may
		// legitimately end with a quote because the JS string does ('win32').
		const expression = raw.startsWith('"') ? JSON.parse(raw)
			: raw.length > 2 && raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1)
				: raw
		checked++
		assert.doesNotThrow(
			() => new Function('baseUrl', 'process', 'ctx', `return (${expression})`),
			`unparseable !!js expression: ${line.trim()}`,
		)
	}
	assert.ok(checked >= 3, `expected several !!js guards, checked ${checked}`)
})
