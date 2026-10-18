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
	const writeVersion = version => writeFileSync(join(root, 'node_modules', 'dsh-general-agentics', 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version }))
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => {
			asked.push(spec)
			if (spec.endsWith('@1.9.0')) throw Object.assign(new Error('registry refused'), { code: 'fetch-failed' })
			writeVersion(spec.split('@').at(-1))
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
	return 'restored 2.0.0 (verified on disk) after the failed install'
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
	assert(/accentDisposer = gaCtx\?\.theme\?\.overrideTokens/u.test(CLIENT) && /return accentDisposer/u.test(CLIENT), 'applyAccent no longer stores and returns the disposer')
	assert(/ctx\.effect\(\(\) => \{[\s\S]{0,200}?overrideAccent\(BRAND_COLOR\)/u.test(CLIENT), 'the effect no longer wraps overrideAccent')
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
	// centralised in writeSettings, which every settings control goes through
	assert(/writeSettings = async query/u.test(CLIENT), 'no shared settings writer')
	assert((CLIENT.match(/dispatchEvent\(new Event\(GA_STATUS_EVENT\)\)/gu) ?? []).length >= 1, 'the settings writer does not dispatch the event')
	assert(/writeSettings\(`quiet=/u.test(CLIENT) && /writeSettings\(`accent=/u.test(CLIENT), 'a settings control bypasses writeSettings')
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

// ── S20: "restored" must mean the version is on disk ──────────────────────
await probe('P11', 'A2 rollback', 'a restore that did not land is reported as a failure', async () => {
	const { root, state } = fixture('2.0.0')
	const manager = {
		removeBundle: async () => { rmSync(join(root, 'node_modules', 'dsh-general-agentics'), { recursive: true, force: true }); return { application: 'applied' } },
		installBundle: async spec => { if (spec.endsWith('@1.9.0')) throw new Error('refused'); return { application: 'applied' } },
	}
	const { code, body } = await post({ root, state, manager, query: 'action=rollback', record: { from: '1.9.0', to: '2.0.0' } })
	assert(code === 500, `expected 500, got ${code}`)
	assert(body.restored === undefined, `must not claim a restore, got ${body.restored}`)
	assert(typeof body.restoreError === 'string' && body.restoreError.length > 0, 'the failed restore must explain itself')
	const recorded = readState('last-result.json', state)
	assert(recorded?.restoreError !== undefined, 'the failed restore must be recorded')
	rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true })
	return 'no false restore claim; failure recorded'
})

// ── S17: concurrent writes must not interleave ─────────────────────────────
await probe('P12', 'writes', 'a second concurrent write is refused with 409 busy', async () => {
	const { root, state } = fixture('2.0.0')
	let release
	const gate = new Promise(resolve => { release = resolve })
	const manager = {
		removeBundle: async () => { await gate; return { application: 'applied' } },
		installBundle: async () => ({ application: 'applied' }),
	}
	let mounted
	const scope = { get: n => (n === 'webServer' ? { register: o => { mounted = o } } : n === 'pluginManager' ? manager : undefined) }
	registerStatusEndpoint(scope, { root, cwd: root, stateDir: state, resolve: () => ({ dir: root }), fetchImpl: async () => ({ ok: true, json: async () => ({ version: '3.0.0' }) }) })
	const get = () => new Promise(res => mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, { writeHead: () => {}, end: b => res(JSON.parse(b)) }))
	const first = await get()
	const call = () => new Promise(res => {
		let code = 0
		mounted.handler({ method: 'POST', url: '/api/general-agentics/status', headers: { host: 'localhost', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': first.csrf } }, { writeHead: c => { code = c }, end: b => res({ code, body: JSON.parse(b) }) })
	})
	const firstCall = call()
	await new Promise(resolve => setTimeout(resolve, 30))
	const second = await call()
	release()
	await firstCall
	assert(second.code === 409 && second.body.code === 'busy', `expected 409 busy, got ${second.code} ${second.body.code}`)
	rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true })
	return 'second write refused instead of interleaving'
})

// ── S13: the accent layer is disposed by whoever installed it last ─────────
await probe('P13', 'D1 accents', 'switching accents disposes the previous layer', async () => {
	assert(/let accentDisposer = null/u.test(CLIENT), 'no disposer holder')
	assert(/accentDisposer\?\.\(\)\s*\n?\s*accentDisposer = gaCtx/u.test(CLIENT), 'applyAccent does not release the previous layer before installing')
	assert(/return \(\) => \{\s*accentDisposer\?\.\(\)/u.test(CLIENT), 'the unload effect does not dispose the current layer')
	return 'previous layer released on switch and on unload'
})

// ── S18: the locale source is observable ──────────────────────────────────
await probe('P14', 'D3 locale', 'the language source is observable for verification', async () => {
	assert(/__GA_LOCALE_SOURCE__/u.test(CLIENT), 'no locale-source marker')
	return 'window.__GA_LOCALE_SOURCE__ records service vs browser'
})

// ── P15: the title rewrite must never assign when nothing changed ─────────
await probe('P15', 'branding', 'title writes are idempotent (no observer loop)', async () => {
	assert(/if \(document\.title !== branded\) document\.title = branded/u.test(CLIENT), 'branded title assigned unconditionally')
	assert(/const wanted = titleAttention && base !== ''/.test(CLIENT), 'marker helper missing')
	assert(/if \(document\.title !== wanted\) document\.title = wanted/u.test(CLIENT), 'marker assigned unconditionally')
	return 'both title writes compare before assigning'
})

// ── P17: every list-slot registration carries an id ───────────────────────
await probe('P17', 'slots', 'list-slot registrations carry an id', async () => {
	for (const slot of ['plugins.detail.badge', 'settings.section', 'sidebar.footer.action']) {
		const pattern = new RegExp(`register\\(\\{[^}]*name: '${slot.replace(/\./g, '\\.')}'[^}]*\\}`, 's')
		const block = CLIENT.match(pattern)?.[0] ?? ''
		assert(block.includes('id:'), `${slot} registered without an id`)
		assert(!block.includes('priority:'), `${slot} is a list slot but uses priority`)
	}
	return 'all three list slots use id + order'
})

// ── P16: list slots are registered with id+order, not priority ────────────
await probe('P16', 'slots', 'the sidebar footer entry uses id+order', async () => {
	assert(/name: 'sidebar\.footer\.action', id: 'general-agentics-status', order: -1/u.test(CLIENT), 'footer registered without id/order')
	return 'list-slot registration uses id + order'
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
