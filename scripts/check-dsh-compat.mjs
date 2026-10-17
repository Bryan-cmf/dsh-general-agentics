#!/usr/bin/env node
/**
 * Release helper: which curated plugin versions can the current DSH accept?
 *
 * DSH 0.2.1 introduced an installation gate (`dsh-app-boot`, lib/types/
 * plugin-compatibility.js). It reads a plugin's manifest WITHOUT importing it:
 *
 *   engines.dsh present  → that range alone decides
 *   else                 → every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
 *                          peerDependency range must match the runtime
 *   else                 → no requirement
 *
 * and evaluates with `semver.satisfies(runtime, range, { includePrerelease: true })`.
 * A plugin that fails makes `dsh plugin add` refuse the WHOLE installation and
 * roll the profile back, so one stale curated plugin can block the bundle.
 *
 * This script applies exactly that rule to every published version of every
 * curated dependency, so the floors we ship stay installable.
 *
 * Usage:
 *   node scripts/check-dsh-compat.mjs                 # probe the installed runtime
 *   node scripts/check-dsh-compat.mjs --dsh-version 0.2.1-rc.2
 *   node scripts/check-dsh-compat.mjs --json
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync as readJsonSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const versionIndex = argv.indexOf('--dsh-version')
const runtimeVersion = versionIndex >= 0
	? argv[versionIndex + 1]
	: readRuntimeVersion()

/**
 * The installed runtime's version, so the check matches this machine. The gate
 * itself reads app-boot's own package.json, so preferring that keeps the two in
 * step even when several runtimes live side by side.
 */
function readRuntimeVersion() {
	const dshHome = process.env.DSH_HOME ?? `${process.env.HOME ?? ''}/.dsh`
	const candidates = [
		`${dshHome}/runtime/node_modules/.bin/dsh`,
		'dsh',
	]
	for (const binary of candidates) {
		try {
			const output = execFileSync(binary, ['--version'], { encoding: 'utf8' })
			const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u.exec(output)
			if (match !== null) return match[1]
		} catch {
			/* try the next candidate */
		}
	}
	// last resort: the app-boot manifest in the runtime store
	try {
		
		const store = `${dshHome}/runtime/node_modules/.pnpm`
		const entry = readdirSync(store).filter(name => name.startsWith('@deepseek-ai+dsh-app-boot@')).sort().at(-1)
		if (entry !== undefined) {
			const path = `${store}/${entry}/node_modules/@deepseek-ai/dsh-app-boot/package.json`
			return JSON.parse(readJsonSync(path, 'utf8')).version
		}
	} catch {
		/* fall through */
	}
	throw new Error('cannot detect the DSH runtime version; pass --dsh-version <version>')
}

/** semver must agree with the gate, so borrow the runtime's copy. */
function loadSemver(version) {
	const dshHome = process.env.DSH_HOME ?? `${process.env.HOME ?? ''}/.dsh`
	const store = `${dshHome}/runtime/node_modules/.pnpm`
	// The gate runs inside app-boot, so borrow ITS semver copy: same version,
	// same prerelease semantics, no dependency added to this package.
	const appBoot = (() => {
		try {
			const entry = readdirSync(store).filter(name => name.startsWith('@deepseek-ai+dsh-app-boot@')).sort().at(-1)
			return entry === undefined ? undefined : `${store}/${entry}/node_modules/@deepseek-ai/dsh-app-boot/package.json`
		} catch {
			return undefined
		}
	})()
	const candidates = [
		appBoot,
		`${dshHome}/runtime/node_modules/@deepseek-ai/dsh/package.json`,
		import.meta.url,
	].filter(anchor => anchor !== undefined)
	for (const anchor of candidates) {
		try {
			const require = createRequire(anchor)
			return require('semver')
		} catch {
			/* try the next anchor */
		}
	}
	throw new Error('semver not found; run this where the DSH runtime is installed')
}

const semver = loadSemver(runtimeVersion)
if (semver.valid(runtimeVersion) === null) throw new Error(`invalid runtime version: ${runtimeVersion}`)

/** The gate's own rule, verbatim in behaviour. */
export function unmetRequirements(pluginManifest, runtime) {
	const engines = pluginManifest.engines ?? {}
	if (Object.hasOwn(engines, 'dsh')) {
		const range = engines.dsh
		return satisfies(range) ? {} : { 'engines.dsh': range }
	}
	const unmet = {}
	for (const [name, range] of Object.entries(pluginManifest.peerDependencies ?? {})) {
		if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
		const effective = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtime : range
		if (!satisfies(effective)) unmet[name] = range
	}
	return unmet

	function satisfies(range) {
		return typeof range === 'string' && range.trim() !== '' && semver.satisfies(runtime, range, { includePrerelease: true })
	}
}

async function packument(name) {
	const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20000) })
	if (!response.ok) throw new Error(`registry ${response.status} for ${name}`)
	return response.json()
}

const rows = []
for (const [name, range] of Object.entries(manifest.dependencies)) {
	const doc = await packument(name)
	const versions = Object.keys(doc.versions)
	const compatible = versions.filter(version => {
		try {
			return Object.keys(unmetRequirements(doc.versions[version], runtimeVersion)).length === 0
		} catch {
			return false
		}
	})
	const newest = doc['dist-tags']?.latest ?? versions.at(-1)
	const newestCompatible = compatible.sort(semver.compare).at(-1)
	const currentFloor = semver.minVersion(range)?.version
	const currentOk = compatible.includes(currentFloor)
	rows.push({ name, range, newest, newestCompatible, currentOk, blocked: newestCompatible !== newest })
}

if (asJson) {
	console.log(JSON.stringify({ runtimeVersion, rows }, null, 2))
} else {
	console.log(`dsh runtime: ${runtimeVersion}\n`)
	console.log('  plugin                              floor        newest       newest accepted by this dsh   verdict')
	for (const row of rows) {
		const verdict = row.currentOk
			? (row.newestCompatible === row.newest ? 'ok' : `cap at ${row.newestCompatible}`)
			: 'FLOOR REJECTED — raise or replace'
		console.log(`  ${row.name.padEnd(34)} ${String(row.range).padEnd(12)} ${String(row.newest).padEnd(12)} ${String(row.newestCompatible ?? 'none').padEnd(28)} ${verdict}`)
	}
	const blocked = rows.filter(row => row.blocked)
	const rejected = rows.filter(row => !row.currentOk)
	console.log(`\n  ${rows.length} curated; ${blocked.length} cannot reach their latest on this runtime; ${rejected.length} have a floor this runtime refuses`)
	if (rejected.length > 0) console.log('  A rejected floor makes the whole bundle installation fail (dsh plugin add rolls back).')
}
