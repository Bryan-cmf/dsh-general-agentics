#!/usr/bin/env node
/**
 * Release helper: where do our curated plugins stand against upstream?
 *
 * Why this exists — measured behaviour (2026-10-17, pnpm 10.33.2, via the
 * tarball install a customer would get):
 *
 *   fresh install with `^x`         → newest version matching the range
 *   bundle version bump, same range → plugins DO NOT move (the lockfile keeps them)
 *   widening `~x.y.z` to `^x.y.z`   → still no move (the lock already satisfies it)
 *   raising the floor (a floor the locked version no longer satisfies)
 *                                   → pnpm re-resolves, the plugin moves
 *   `pnpm update` in the profile    → everything moves to newest matching
 *
 *   Since 0.3.0 the third-party set lives in a CATALOG (lib/catalog.mjs): a
 *   user installs and updates each one with a click, so updating those is
 *   just that click. The floors that remain belong to the first-party
 *   plugins this bundle still ships as dependencies, and the same floor
 *   rules apply to them. This report keeps both visible side by side.
 *
 * Note on 0.x: `^0.68.1` means `>=0.68.1 <0.69.0`, so caret does NOT admit
 * minor updates below 1.0. Those always need an explicit floor raise, and 0.x
 * minors are exactly where upstream is still allowed to break.
 *
 * Usage: node scripts/check-upstream.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const asJson = process.argv.includes('--json')

/** Lowest version a range admits, as [major, minor, patch]. */
export function floorOf(range) {
	const match = /(\d+)\.(\d+)\.(\d+)/u.exec(range)
	return match === null ? [0, 0, 0] : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** What kind of jump separates a declared range from a published version. */
export function bumpKind(from, to) {
	const a = floorOf(from)
	const b = floorOf(to)
	if (b[0] !== a[0]) return 'major'
	if (b[1] !== a[1]) return 'minor'
	if (b[2] !== a[2]) return 'patch'
	return 'same'
}

/** `^0.x` admits patch-level updates only; `^1.x` and up admits minors too. */
export function admitted(floor, version) {
	const [major, minor] = floorOf(floor)
	const [versionMajor, versionMinor] = floorOf(version)
	if (versionMajor !== major) return false
	return major === 0 ? versionMinor === minor : versionMinor >= minor
}

async function latest(name) {
	try {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, { signal: AbortSignal.timeout(8000) })
		if (!response.ok) return undefined
		return (await response.json()).version
	} catch {
		return undefined
	}
}

const { CATALOG } = await import('../lib/catalog.mjs')
const rows = []
for (const [name, range] of Object.entries(manifest.dependencies)) {
	const published = await latest(name)
	rows.push({ name, range, latest: published, world: 'bundled', kind: published === undefined ? 'unknown' : bumpKind(range, published) })
}
for (const entry of CATALOG) {
	const published = await latest(entry.name)
	rows.push({ name: entry.name, range: '(catalog)', latest: published, world: 'catalog', kind: published === undefined ? 'unknown' : 'any' })
}

if (asJson) {
	console.log(JSON.stringify(rows, null, 2))
} else {
	console.log(`bundled + catalog: ${rows.length}\n`)
	console.log('  plugin                              range        latest       gap      what an update would take')
	for (const row of rows) {
		const action = row.latest === undefined ? 'registry unreachable'
			: row.world === 'catalog'
				? 'one click in the panel (the user owns the row)'
			: row.kind === 'same' ? 'already current'
				: admitted(row.range, row.latest)
					? 'flows to fresh installs; existing profiles need a floor raise'
					: `raise floor to ^${row.latest}`
		console.log(`  ${row.name.padEnd(34)} ${row.range.padEnd(12)} ${String(row.latest ?? '?').padEnd(12)} ${row.kind.padEnd(8)} ${action}`)
	}
	const movable = rows.filter(row => row.world === 'bundled' && row.kind !== 'same' && row.kind !== 'unknown')
	const majors = rows.filter(row => row.kind === 'major')
	const bundledRows = rows.filter(row => row.world === 'bundled')
	const catalogRows = rows.filter(row => row.world === 'catalog')
	console.log(`\n  bundled: ${movable.length} of ${bundledRows.length} could move (${majors.length} major); catalog: ${catalogRows.filter(r => r.kind === 'any').length} of ${catalogRows.length} have a newer release one click away`)
}
