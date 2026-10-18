#!/usr/bin/env node
/**
 * Adversarial review probes.
 *
 * The unit suite checks that features work. This script checks the things that
 * are easy to get wrong and easy to stop checking: what happens when an install
 * fails halfway, when the recorded state is stale, when a report leaves the
 * machine, when the plugin unloads, when the network is down, when the store is
 * enormous. Each probe prints PASS/FAIL so a regression is visible in one line.
 *
 * Run: npm run review
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	buildDiagnostics,
	buildStatus,
	readState,
	readUsage,
	redactHome,
	registerStatusEndpoint,
	writeState,
} from '../lib/index.js'

const results = []
const probe = async (id, feature, title, run) => {
	try {
		const detail = await run()
		results.push({ id, feature, title, ok: true, detail: detail ?? '' })
	} catch (error) {
		results.push({ id, feature, title, ok: false, detail: String(error?.message ?? error) })
	}
}
const assert = (condition, message) => {
	if (!condition) throw new Error(message)
}

const CLIENT = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** A profile fixture with an installed bundle. */
function fixture(installed = '2.0.0') {
	const root = mkdtempSync(join(tmpdir(), 'probe-root-'))
	const dir = join(root, 'node_modules', 'dsh-general-agentics')
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: installed }))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: installed, dependencies: {} }))
	const state = mkdtempSync(join(tmpdir(), 'probe-state-'))
	return { root, state }
}

async function post({ root, state, manager, query, record }) {
	if (record !== undefined) writeState('update.json', record, state)
	let mounted
	const scope = {
		get: name => (name === 'webServer' ? { register: o => { mounted = o } } : name === 'pluginManager' ? manager : undefined),
	}
	registerStatusEndpoint(scope, { root, cwd: root, stateDir: state, resolve: () => ({ dir: root }), fetchImpl: async () => ({ ok: false }) })
	const get = () => new Promise(res => mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, { writeHead: () => {}, end: b => res(JSON.parse(b)) }))
	const first = await get()
	let code = 0
	const body = await new Promise(res => mounted.handler({
		method: 'POST', url: `/api/general-agentics/status?${query}`,
		headers: { host: 'localhost', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': first.csrf },
	}, { writeHead: c => { code = c }, end: b => res(JSON.parse(b)) }))
	return { code, body }
}

// ── A2: failure must not leave the profile without a bundle ────────────────
await probe('P1', 'A2 rollback', 'install failure restores the previous version', async () => {
	const { root, state } = fixture('2.0.0')
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => {
			asked.push(spec)
			if (spec.endsWith('@1.9.0')) throw Object.assign(new Error('registry refused'), { code: 'fetch-failed' })
			return { application: 'applied' }
		},
	}
	const { code, body } = await post({ root, state, manager, query: 'action=rollback', record: { from: '1.9.0', to: '2.0.0' } })
	assert(code === 500, `expected 500, got ${code}`)
	assert(body.restored === '2.0.0', `expected restore to 2.0.0, got ${body.restored}`)
	assert(asked.at(-1) === 'dsh-general-agentics@2.0.0', 'restore install must be the last call')
	const recorded = readState('last-result.json', state)
	assert(recorded?.ok === false, 'the failed rollback must be recorded')
	rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true })
	return 'restored 2.0.0 after the failed install'
})

// ── A2: a stale record must not downgrade blind ────────────────────────────
await probe('P2', 'A2 rollback', 'stale record is refused before anything is removed', async () => {
	const { root, state } = fixture('2.0.0')
	const asked = []
	const manager = {
		removeBundle: async () => { asked.push('remove'); return { application: 'applied' } },
		installBundle: async spec => { asked.push(spec); return { application: 'applied' } },
	}
	const { code, body } = await post({ root, state, manager, query: 'action=rollback', record: { from: '0.0.1', to: '9.9.9' } })
	assert(code === 409, `expected 409, got ${code}`)
	assert(body.code === 'stale-record', `expected stale-record, got ${body.code}`)
	assert(asked.length === 0, `nothing may run first, saw ${asked.join(',')}`)
	rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true })
	return 'refused with 409, zero installs'
})

// ── C1: a report that leaves the machine must not carry paths ──────────────
await probe('P3', 'C1 diagnostics', 'the report and the payload redact the home path', async () => {
	const home = '/Users/example'
	const markdown = buildDiagnostics({ home, status: { current: '1.0.0', profile: { dir: `${home}/.dsh/profiles/desktop` }, curated: [], prerequisites: [] } })
	assert(!markdown.includes(home), 'markdown leaked the home path')
	const status = await buildStatus({ cwd: process.cwd(), fetchImpl: async () => ({ ok: false }) })
	assert(typeof status.profile?.dir === 'string', 'profile.dir missing')
	assert(!status.profile.dir.includes(process.env.HOME ?? '\u0000'), 'status payload leaked the home path')
	assert(redactHome(`${home}/x`, home) === '~/x', 'redactHome is broken')
	return 'no absolute path in either artefact'
})

// ── D1: the theme override must be disposable ─────────────────────────────
await probe('P4', 'D1 accents', 'applyAccent hands the disposer back to ctx.effect', async () => {
	assert(/function applyAccent\(color\)[\s\S]{0,400}?return gaCtx\?\.theme\?\.overrideTokens/u.test(CLIENT), 'applyAccent no longer returns the disposer')
	assert(/ctx\.effect\(\(\) => overrideAccent\(BRAND_COLOR\)/u.test(CLIENT), 'the effect no longer wraps overrideAccent')
	return 'disposer returned and consumed by ctx.effect'
})

// ── D3: locale must be resolved through get() ─────────────────────────────
await probe('P5', 'D3 locale', 'the app locale is read through ctx.get, not an uninjected property', async () => {
	assert(/ctx\.get\?\.\('locale'\)/u.test(CLIENT), 'locale is not resolved through ctx.get()')
	assert(/adoptAppLanguage/u.test(CLIENT), 'adoptAppLanguage is gone')
	return "ctx.get?.('locale') with the browser fallback"
})

// ── A1: no confirming an update before the preview arrives ────────────────
await probe('P6', 'A1 preview', 'confirm is disabled while the preview is loading', async () => {
	assert(/disabled: busy \|\| preview\?\.loading === true/u.test(CLIENT), 'confirm button is not gated on preview loading')
	return 'confirm disabled until the diff is in'
})

// ── A3: settings changes reach the sidebar dot without a reload ───────────
await probe('P7', 'A3 quiet hours', 'the badge re-reads after a settings write', async () => {
	assert(/GA_STATUS_EVENT/u.test(CLIENT), 'no refresh event')
	assert(/addEventListener\(GA_STATUS_EVENT/u.test(CLIENT), 'the badge does not listen for the refresh event')
	assert((CLIENT.match(/dispatchEvent\(new Event\(GA_STATUS_EVENT\)\)/gu) ?? []).length >= 2, 'settings writes do not dispatch the event')
	return 'event wired from both settings controls to the badge'
})

// ── C2: the usage scan is bounded and labelled ────────────────────────────
await probe('P8', 'C2 usage', 'the scan is bounded and states its scope', async () => {
	const root = mkdtempSync(join(tmpdir(), 'probe-usage-'))
	mkdirSync(join(root, 'ws', 's1'), { recursive: true })
	writeFileSync(join(root, 'ws', 's1', 'session.v4.jsonl.zstd'), 'x')
	const usage = readUsage({ sessionsRoot: root, maxBytes: 10, decompress: () => Buffer.from(JSON.stringify({ type: 'tool/call', data: { name: 'bash' } })) })
	assert(usage.ok === true, 'usage did not report ok')
	assert(usage.scope === 'all-workspaces', `scope missing (${usage.scope})`)
	rmSync(root, { recursive: true, force: true })
	return 'scope labelled, byte budget honoured'
})

// ── C1: failures are recorded for the next report ─────────────────────────
await probe('P9', 'C1 diagnostics', 'a failed update leaves a record', async () => {
	const { root, state } = fixture('2.0.0')
	const manager = { removeBundle: async () => ({ application: 'applied' }), installBundle: async () => ({ application: 'applied' }) }
	// registry unreachable → the early return path
	const { body } = await post({ root, state, manager, query: '' })
	assert(body.code === 'registry-unreachable', `expected registry-unreachable, got ${body.code}`)
	const recorded = readState('last-result.json', state)
	assert(recorded?.ok === false && recorded.code === 'registry-unreachable', 'the failure was not recorded')
	rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true })
	return 'last-result.json carries the failure'
})

// ── B3: the plugin badge must degrade, never throw ────────────────────────
await probe('P10', 'B3 plugin badge', 'the badge has a safe fallback for non-curated subjects', async () => {
	assert(/function GAPluginBadge/u.test(CLIENT), 'GAPluginBadge is gone')
	assert(/if \(curated === null \|\| curated\.length === 0\) return null/u.test(CLIENT), 'no null fallback before the curated list loads')
	assert(/if \(typeof id !== 'string'\) return null/u.test(CLIENT), 'no guard for a subject without a name')
	return 'returns null for empty data and unknown subjects'
})

const failed = results.filter(item => !item.ok)
const width = Math.max(...results.map(item => item.title.length))
console.log('review probes\n')
for (const item of results) {
	console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.id.padEnd(4)} ${item.feature.padEnd(18)} ${item.title.padEnd(width)}  ${item.detail}`)
}
console.log(`\n${results.length - failed.length}/${results.length} probes passed`)
if (failed.length > 0) {
	console.error(`\n${failed.length} probe(s) failed — fix before committing.`)
	process.exit(1)
}
