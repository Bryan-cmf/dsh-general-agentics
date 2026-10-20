/**
 * Tests for the ga-status MCP server (mcp/ga-status-server.mjs).
 *
 * The server speaks JSON-RPC over stdio when it is the entry point, and
 * exports its pure helpers otherwise — so everything below is exercised
 * without spawning a process or writing anything.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileURLToPath } from 'node:url'
import {
	bundleInfoText,
	curatedPlugins,
	duplicatePlugins,
	handleMessage,
	healthReport,
	listSkills,
	prerequisiteReport,
	probeCommand,
	readProfileManifest,
} from '../mcp/ga-status-server.mjs'

/** A throwaway profile dir holding just a package.json. */
function makeProfile(manifest) {
	const dir = mkdtempSync(join(tmpdir(), 'ga-profile-'))
	writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
	return dir
}

const DEP = 'dsh-promptimizer'
const ROOT_FOR_TEST = fileURLToPath(new URL('..', import.meta.url))

test('curatedPlugins lists this bundle\'s dependencies', () => {
	// Since 0.3.0 the manifest carries only the first-party plugins; the
	// third-party set moved to the catalog (see lib/catalog.mjs).
	const curated = curatedPlugins()
	assert.deepEqual([...curated].sort(), ['dsh-comments', 'dsh-promptimizer'])
})

test('listSkills finds the bundled SKILL.md directories', () => {
	const skills = listSkills()
	assert.equal(skills.length, 14, `expected 14 bundled skills, got ${skills.length}`)
	assert.ok(skills.includes('ga-identity'))
})

test('bundleInfoText reports package identity, skills and curated plugins', () => {
	const text = bundleInfoText()
	assert.match(text, /package: dsh-general-agentics@\d/)
	assert.match(text, /product: General Agentics \(GA\)/)
	assert.match(text, /bundled skills: .*ga-identity/)
	assert.match(text, new RegExp(`curated plugin dependencies: .*${DEP.replace(/[/@]/gu, '\\$&')}`))
	assert.match(text, /Built on DeepSeek Harness \(DSH\), MIT licensed/)
})

test('readProfileManifest reads dependencies and the bundles list', () => {
	const dir = makeProfile({
		dependencies: { 'dsh-general-agentics': 'link:..' },
		dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-general-agentics'] } },
	})
	const profile = readProfileManifest(dir)
	assert.deepEqual(profile.dependencies, ['dsh-general-agentics'])
	assert.deepEqual(profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-general-agentics'])
	assert.equal(profile.source, 'cwd')
	rmSync(dir, { recursive: true, force: true })
})

test('readProfileManifest ignores cwd when cwd is this bundle itself', () => {
	// A manual run from the repo: cwd holds our own package.json, which must
	// not be mistaken for a profile that installs everything twice.
	const fakeRoot = mkdtempSync(join(tmpdir(), 'ga-root-'))
	writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics' }))
	const profile = readProfileManifest(ROOT_FOR_TEST, fakeRoot)
	if (profile !== undefined) assert.notEqual(profile.source, 'cwd')
	rmSync(fakeRoot, { recursive: true, force: true })
})

test('readProfileManifest returns undefined when there is no manifest', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ga-empty-'))
	assert.equal(readProfileManifest(dir), undefined)
	rmSync(dir, { recursive: true, force: true })
})

test('duplicatePlugins finds curated plugins the profile installs directly', () => {
	const curated = ['a', 'b', DEP]
	const clean = { dependencies: ['dsh-general-agentics'], bundles: ['dsh-general-agentics'] }
	assert.deepEqual(duplicatePlugins(curated, clean), [])
	const duplicated = {
		dependencies: ['dsh-general-agentics', DEP],
		bundles: ['dsh-general-agentics'],
	}
	assert.deepEqual(duplicatePlugins(curated, duplicated), [DEP])
	// a profile bundle entry counts as a direct install too
	const viaBundles = { dependencies: [], bundles: [DEP] }
	assert.deepEqual(duplicatePlugins(curated, viaBundles), [DEP])
	assert.deepEqual(duplicatePlugins(curated, undefined), [])
})

test('probeCommand reports PATH membership without executing anything', () => {
	assert.equal(probeCommand('node'), true)
	assert.equal(probeCommand('definitely-not-a-real-binary-xyz'), false)
	assert.equal(probeCommand('node', ''), false)
})

test('prerequisiteReport marks probed and unprobed requirements', () => {
	const withProbe = prerequisiteReport(['dsh-browser-use'], () => false)
	assert.equal(withProbe.length, 1)
	assert.match(withProbe[0], /`uv` CLI/)
	assert.match(withProbe[0], /MISSING \(uv\)/)

	const found = prerequisiteReport(['dsh-browser-use'], () => true)
	assert.match(found[0], /found on PATH/)

	assert.equal(prerequisiteReport(['dsh-market'], () => true).length, 0)
})

test('healthReport says the deployment is clean when nothing is duplicated', () => {
	const dir = makeProfile({
		dependencies: { 'dsh-general-agentics': 'link:..' },
		dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-general-agentics'] } },
	})
	const report = healthReport({ cwd: dir, probe: () => true })
	assert.match(report, /duplicate installs:\n {2}none/)
	assert.match(report, /external prerequisites/)
	assert.match(report, /Settings → Experts/)
	rmSync(dir, { recursive: true, force: true })
})

test('healthReport names the duplicated plugin and the fix', () => {
	const dir = makeProfile({
		dependencies: { 'dsh-general-agentics': 'link:..', [DEP]: '^1.0.13' },
		dsh: { profile: { bundles: ['dsh-general-agentics'] } },
	})
	const report = healthReport({ cwd: dir, probe: () => false })
	assert.match(report, /1 curated plugin\(s\) are ALSO installed directly/)
	assert.ok(report.includes(`- ${DEP}`))
	assert.match(report, /remove the direct install/)
	assert.match(report, /rules 12 and 17/)
	rmSync(dir, { recursive: true, force: true })
})

test('healthReport degrades gracefully without a readable profile manifest', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ga-nomanifest-'))
	const report = healthReport({ cwd: dir, probe: () => true })
	assert.match(report, /manifest not found/)
	assert.match(report, /duplicate detection skipped/)
	rmSync(dir, { recursive: true, force: true })
})

test('tools/list advertises both tools', () => {
	const sent = []
	const original = process.stdout.write.bind(process.stdout)
	process.stdout.write = chunk => { sent.push(String(chunk)); return true }
	try {
		handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
	} finally {
		process.stdout.write = original
	}
	const payload = JSON.parse(sent.join(''))
	assert.deepEqual(payload.result.tools.map(t => t.name), ['ga_bundle_info', 'ga_health_check'])
})

test('tools/call dispatches ga_health_check', () => {
	const sent = []
	const original = process.stdout.write.bind(process.stdout)
	process.stdout.write = chunk => { sent.push(String(chunk)); return true }
	try {
		handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ga_health_check', arguments: {} } })
	} finally {
		process.stdout.write = original
	}
	const payload = JSON.parse(sent.join(''))
	assert.equal(payload.result.isError, false)
	assert.match(payload.result.content[0].text, /duplicate installs:/)
})

test('unknown tools still return a JSON-RPC error', () => {
	const sent = []
	const original = process.stdout.write.bind(process.stdout)
	process.stdout.write = chunk => { sent.push(String(chunk)); return true }
	try {
		handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })
	} finally {
		process.stdout.write = original
	}
	const payload = JSON.parse(sent.join(''))
	assert.equal(payload.error.code, -32602)
})
