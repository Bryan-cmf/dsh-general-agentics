/**
 * Tests for the settings-panel host half (lib/index.js).
 *
 * The panel's whole job is to tell the truth about an installation, so these
 * cover the three things that were wrong on the first attempt and would show
 * a user a false picture: resolving the profile (cwd is not it), reading
 * installed versions (must resolve from the profile, not from this module) and
 * comparing versions (a local build ahead of the registry is not "update
 * available").
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	allowWrite,
	buildStatus,
	compareSemver,
	diffDependencies,
	fetchLatestVersion,
	normalizeWindow,
	parseQuiet,
	readState,
	installedVersion,
	profileNameFromDir,
	profileSpecFor,
	readOwnManifest,
	quietHoursActive,
	registerStatusEndpoint,
	writeState,
	resolveProfile,
	STATUS_ENDPOINT,
} from '../lib/index.js'

const HOME = process.env.HOME ?? '/tmp'
const DSH_HOME = join(HOME, '.dsh')

/** A throwaway profile directory with a manifest. */
function makeProfile(name, manifest) {
	const dir = mkdtempSync(join(tmpdir(), 'ga-panel-'))
	writeFileSync(join(dir, 'package.json'), JSON.stringify({
		name: `dsh-profile-${name}`,
		dsh: { profile: { bundles: [] } },
		...manifest,
	}))
	return dir
}

const fakeFetch = versions => async url => {
	const match = /registry\.npmjs\.org\/(?:%40[^/]+\/)?([^/]+)\/latest/u.exec(decodeURIComponent(url))
	const version = match === null ? undefined : versions[match[1]] ?? versions[decodeURIComponent(url.split('/').slice(-2)[0])]
	if (version === undefined) return { ok: false, json: async () => ({}) }
	return { ok: true, json: async () => ({ version }) }
}

test('resolveProfile prefers the profile path the host passes in argv', () => {
	const resolved = resolveProfile({ argv: ['node', 'dsh', join(DSH_HOME, 'profiles', 'desktop')], cwd: '/tmp' })
	assert.equal(resolved.name, 'desktop')
	assert.equal(resolved.dir, join(DSH_HOME, 'profiles', 'desktop'))
	assert.equal(resolved.source, 'argv-path')
})

test('resolveProfile reads --profile and --profile=<name>', () => {
	const short = resolveProfile({ argv: ['node', 'dsh', '--profile', 'ga-x', 'web'], env: { DSH_HOME } })
	assert.deepEqual([short.name, short.dir, short.source], ['ga-x', join(DSH_HOME, 'profiles', 'ga-x'), 'argv-profile'])
	const inline = resolveProfile({ argv: ['node', 'dsh', '--profile=ga-y'], env: { DSH_HOME } })
	assert.equal(inline.name, 'ga-y')
})

test('resolveProfile rejects a cwd that only looks like one, accepts a real profile', () => {
	// /tmp holds no manifest → nothing to resolve
	assert.equal(resolveProfile({ argv: ['node'], cwd: '/tmp' }), undefined)
	// a package.json without dsh.profile is not a profile either
	const plain = mkdtempSync(join(tmpdir(), 'ga-plain-'))
	writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'not-a-profile' }))
	assert.equal(resolveProfile({ argv: ['node'], cwd: plain }), undefined)
	rmSync(plain, { recursive: true, force: true })
	// and a real one resolves through cwd
	const real = makeProfile('by-cwd', {})
	assert.equal(resolveProfile({ argv: ['node'], cwd: real }).source, 'cwd')
	rmSync(real, { recursive: true, force: true })
})

test('profileNameFromDir takes the last path segment', () => {
	assert.equal(profileNameFromDir('/Users/x/.dsh/profiles/desktop'), 'desktop')
	assert.equal(profileNameFromDir('/Users/x/.dsh/profiles/web/'), 'web')
	assert.equal(profileNameFromDir(undefined), undefined)
})

test('profileSpecFor reports link: and file: installs distinctly', () => {
	const dir = makeProfile('specs', { dependencies: { 'dsh-general-agentics': 'link:/somewhere' } })
	const linked = profileSpecFor(dir, 'dsh-general-agentics')
	assert.equal(linked.devInstall, true)
	assert.equal(linked.frozenInstall, false)
	writeFileSync(join(dir, 'package.json'), JSON.stringify({
		name: 'dsh-profile-specs',
		dsh: { profile: { bundles: [] } },
		dependencies: { 'dsh-general-agentics': 'file:./x.tgz' },
	}))
	const frozen = profileSpecFor(dir, 'dsh-general-agentics')
	assert.equal(frozen.devInstall, false)
	assert.equal(frozen.frozenInstall, true)
	rmSync(dir, { recursive: true, force: true })
})

test('installedVersion resolves from the profile it is told about', () => {
	const dir = makeProfile('installed', { dependencies: {} })
	mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true })
	writeFileSync(join(dir, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', version: '9.9.9' }))
	assert.equal(installedVersion('left-pad', dir), '9.9.9')
	assert.equal(installedVersion('definitely-not-installed-xyz', dir), undefined)
	rmSync(dir, { recursive: true, force: true })
})

test('compareSemver orders releases and prereleases', () => {
	assert.equal(compareSemver('0.12.0', '0.11.4'), 1)
	assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
	assert.equal(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10'), -1)
	assert.equal(compareSemver('1.0.0-alpha.1', '1.0.0'), -1)
	assert.equal(compareSemver('0.2.0-alpha.14', '0.2.0-alpha.12'), 1)
})

test('buildStatus: a local build ahead of the registry is not an update', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '0.2.0-alpha.14', dependencies: {} }))
	mkdirSync(join(root, 'skills', 'ga-identity'), { recursive: true })
	writeFileSync(join(root, 'skills', 'ga-identity', 'SKILL.md'), '---\nname: ga-identity\ndescription: identity\n---\n\nBody.\n')
	const profile = makeProfile('ahead', { dependencies: { 'dsh-general-agentics': 'link:/x' } })
	const status = await buildStatus({
		root,
		cwd: '/tmp',
		resolve: () => ({ dir: profile, name: 'ahead', source: 'argv-profile' }),
		fetchImpl: fakeFetch({ 'dsh-general-agentics': '0.2.0-alpha.12' }),
	})
	assert.equal(status.updateAvailable, false)
	assert.equal(status.localAhead, true)
	assert.deepEqual(status.skills, ['ga-identity'])
	assert.equal(status.profile.name, 'ahead')
	assert.equal(status.profile.devInstall, true)
	assert.match(status.updateCommand, /--profile ahead add dsh-general-agentics@latest/u)
	rmSync(root, { recursive: true, force: true })
	rmSync(profile, { recursive: true, force: true })
})

test('buildStatus: per-plugin matrix flags only genuinely newer plugins', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root2-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({
		name: 'dsh-general-agentics',
		version: '0.2.0-alpha.14',
		dependencies: { 'newer-plugin': '^1.0.0', 'same-plugin': '^2.0.0', 'missing-plugin': '^3.0.0' },
	}))
	const profile = makeProfile('matrix', { dependencies: { 'dsh-general-agentics': 'file:./x.tgz' } })
	for (const [name, version] of [['newer-plugin', '1.0.0'], ['same-plugin', '2.0.0']]) {
		mkdirSync(join(profile, 'node_modules', name), { recursive: true })
		writeFileSync(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
	}
	const status = await buildStatus({
		root,
		cwd: '/tmp',
		includePlugins: true,
		resolve: () => ({ dir: profile, name: 'matrix', source: 'argv-profile' }),
		fetchImpl: fakeFetch({
			'dsh-general-agentics': '0.2.0-alpha.20',
			'newer-plugin': '1.4.0',
			'same-plugin': '2.0.0',
			'missing-plugin': '3.1.0',
		}),
	})
	const byName = Object.fromEntries(status.curated.map(plugin => [plugin.name, plugin]))
	assert.equal(status.updateAvailable, true)
	assert.equal(byName['newer-plugin'].updateAvailable, true)
	assert.equal(byName['same-plugin'].updateAvailable, false)
	assert.equal(byName['missing-plugin'].installed, undefined)
	assert.equal(byName['missing-plugin'].updateAvailable, false, 'nothing installed is not an update')
	assert.equal(status.profile.frozenInstall, true)
	rmSync(root, { recursive: true, force: true })
	rmSync(profile, { recursive: true, force: true })
})

test('buildStatus survives an unreachable registry', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root3-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '9.9.9', dependencies: {} }))
	const offline = async () => { throw new Error('getaddrinfo ENOTFOUND') }
	const status = await buildStatus({ root, cwd: '/tmp', includePlugins: true, resolve: () => undefined, fetchImpl: offline })
	assert.equal(status.latest, undefined)
	assert.equal(status.updateAvailable, false)
	assert.equal(status.profile.dir, '/tmp')
	rmSync(root, { recursive: true, force: true })
})

test('readOwnManifest returns this package, including its curated list', () => {
	const manifest = readOwnManifest()
	assert.equal(manifest.name, 'dsh-general-agentics')
	assert.ok(Object.keys(manifest.dependencies).length >= 11)
})

test('registerStatusEndpoint: GET returns status, unknown methods are rejected', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root4-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const server = { register: options => { mounted = options; return () => {} } }
	const scope = { get: name => (name === 'webServer' ? server : undefined) }
	assert.equal(registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.4' }) }), true)
	assert.equal(mounted.path, STATUS_ENDPOINT)

	const call = async (method, url) => {
		let captured
		await mounted.handler({ method, url }, {
			writeHead: (status, headers) => { captured = { status, headers } },
			end: body => { captured.body = JSON.parse(body) },
		})
		return captured
	}
	const ok = await call('GET', '/api/general-agentics/status')
	assert.equal(ok.status, 200)
	assert.equal(ok.body.current, '1.2.3')
	assert.equal(ok.body.updateAvailable, true)
	assert.match(ok.headers['content-type'], /application\/json/u)
	assert.equal((await call('PUT', '/api/general-agentics/status')).status, 405)
	rmSync(root, { recursive: true, force: true })
})


/** Perform the panel's two-step write: GET for the token, POST with it. */
async function postWithToken(mounted, headers = {}) {
	let csrf
	await mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, {
		writeHead: () => {},
		end: body => { csrf = JSON.parse(body).csrf },
	})
	let captured
	await mounted.handler({
		method: 'POST',
		url: '/api/general-agentics/status',
		headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': csrf, ...headers },
	}, {
		writeHead: status => { captured = { status } },
		end: body => { captured.body = JSON.parse(body) },
	})
	return captured
}

test('registerStatusEndpoint: POST without a plugin manager hands back the command', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root5-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : undefined) }
	// the panel asks the registry what is current before touching the manager
	registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.4' }) })
	const captured = await postWithToken(mounted)
	assert.equal(captured.status, 200)
	assert.equal(captured.body.ok, false)
	assert.equal(captured.body.manual, true)
	assert.match(captured.body.command, /add dsh-general-agentics@latest/u)
	rmSync(root, { recursive: true, force: true })
})

test('registerStatusEndpoint: a profile without a web server is not an error', () => {
	assert.equal(registerStatusEndpoint({ get: () => undefined }), false)
})

test('registerStatusEndpoint: POST delegates to the plugin manager when present', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root6-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => { asked.push(spec); return { application: 'restart-required' } },
	}
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : name === 'pluginManager' ? manager : undefined) }
	// the panel asks the registry what is current before touching the manager
	// a temp state dir: the success path records the rollback target, and tests
	// must never write into the real ${DSH_HOME}
	const state = mkdtempSync(join(tmpdir(), 'ga-state5-'))
	registerStatusEndpoint(scope, { root, cwd: '/tmp', stateDir: state, fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.4' }) })
	const captured = await postWithToken(mounted)
	assert.deepEqual(asked, ['remove:dsh-general-agentics', 'dsh-general-agentics@1.2.4'])
	assert.equal(captured.status, 200)
	assert.equal(captured.body.ok, true)
	assert.equal(captured.body.restartRequired, true)
	rmSync(root, { recursive: true, force: true })
})

test('buildStatus flags a curated plugin the profile also installs itself', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root7-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({
		name: 'dsh-general-agentics',
		version: '1.0.0',
		dependencies: { 'double-plugin': '^1.0.0', 'single-plugin': '^1.0.0' },
	}))
	// the profile installs one of them directly as well — the coexistence case
	// the ga- row ids exist for
	const profile = makeProfile('coexist', {
		dependencies: { 'dsh-general-agentics': 'file:./x.tgz', 'double-plugin': '^1.0.0' },
	})
	for (const name of ['double-plugin', 'single-plugin']) {
		mkdirSync(join(profile, 'node_modules', name), { recursive: true })
		writeFileSync(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
	}
	const status = await buildStatus({
		root,
		cwd: '/tmp',
		resolve: () => ({ dir: profile, name: 'coexist', source: 'argv-profile' }),
		fetchImpl: fakeFetch({}),
	})
	const byName = Object.fromEntries(status.curated.map(plugin => [plugin.name, plugin]))
	assert.equal(byName['double-plugin'].alsoDirect, true)
	assert.equal(byName['single-plugin'].alsoDirect, false)
	assert.deepEqual(status.profile.dependencies, ['dsh-general-agentics', 'double-plugin'])
	rmSync(root, { recursive: true, force: true })
	rmSync(profile, { recursive: true, force: true })
})

test('allowWrite: the panel token is required and checked', () => {
	const token = 'abc123'
	assert.equal(allowWrite({ headers: { 'x-ga-csrf': token } }, token), true)
	// no token at all (a blind curl)
	assert.equal(allowWrite({ headers: {} }, token), false)
	// wrong token
	assert.equal(allowWrite({ headers: { 'x-ga-csrf': 'nope' } }, token), false)
	// right token, but the browser says the request came from another site
	assert.equal(allowWrite({ headers: { 'x-ga-csrf': token, 'sec-fetch-site': 'cross-site' } }, token), false)
	// right token, but an Origin for another host
	assert.equal(allowWrite({ headers: { 'x-ga-csrf': token, host: 'localhost:3000', origin: 'https://evil.example' } }, token), false)
	// a same-origin fetch from our own page
	assert.equal(allowWrite({ headers: { 'x-ga-csrf': token, host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } }, token), true)
})

test('registerStatusEndpoint: a write without the token is refused before any install', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root8-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => { asked.push(spec); return { application: 'applied' } },
	}
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : name === 'pluginManager' ? manager : undefined) }
	registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.4' }) })
	let captured
	await mounted.handler({ method: 'POST', url: '/api/general-agentics/status', headers: {} }, {
		writeHead: status => { captured = { status } },
		end: body => { captured.body = JSON.parse(body) },
	})
	assert.equal(captured.status, 403)
	assert.equal(captured.body.code, 'forbidden')
	assert.deepEqual(asked, [], 'nothing may be installed without the token')
	rmSync(root, { recursive: true, force: true })
})

test('fetchLatestVersion caches registry answers for the TTL', async () => {
	let calls = 0
	const counting = async () => { calls++; return { ok: true, json: async () => ({ version: '9.9.9' }) } }
	const first = await fetchLatestVersion('cached-plugin', { fetchImpl: counting, cache: true })
	const second = await fetchLatestVersion('cached-plugin', { fetchImpl: counting, cache: true })
	assert.equal(first, '9.9.9')
	assert.equal(second, '9.9.9')
	assert.equal(calls, 1, 'the second lookup must come from the cache')
	// a different name is still fetched
	await fetchLatestVersion('another-plugin', { fetchImpl: counting, cache: true })
	assert.equal(calls, 2)
	// and cache:false always fetches
	await fetchLatestVersion('cached-plugin', { fetchImpl: counting, cache: false })
	assert.equal(calls, 3)
})

test('buildStatus still answers when the registry is unreachable', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root9-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({
		name: 'dsh-general-agentics', version: '1.2.3', dependencies: { 'some-plugin': '^1.0.0' },
	}))
	const status = await buildStatus({
		root, cwd: '/tmp',
		fetchImpl: async () => { throw new Error('offline') },
	})
	assert.equal(status.current, '1.2.3')
	assert.equal(status.latest, undefined)
	assert.equal(status.updateAvailable, false)
	assert.equal(status.curated.length, 1)
	assert.equal(status.curated[0].installed, undefined)
	assert.equal(status.curated[0].latest, undefined)
	rmSync(root, { recursive: true, force: true })
})

test('diffDependencies reports added, removed and changed plugins', () => {
	const current = { a: '^1.0.0', b: '^2.0.0', c: '^3.0.0' }
	const next = { a: '^1.1.0', c: '^3.0.0', d: '^4.0.0' }
	assert.deepEqual(diffDependencies(current, next), [
		{ name: 'a', from: '^1.0.0', to: '^1.1.0', kind: 'changed' },
		{ name: 'b', from: '^2.0.0', to: undefined, kind: 'removed' },
		{ name: 'd', from: undefined, to: '^4.0.0', kind: 'added' },
	])
	assert.deepEqual(diffDependencies({}, {}), [])
})

test('readState/writeState round-trips and tolerates junk', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ga-state-'))
	assert.equal(writeState('update.json', { from: '1.0.0', to: '1.1.0' }, dir), true)
	assert.deepEqual(readState('update.json', dir), { from: '1.0.0', to: '1.1.0' })
	writeFileSync(join(dir, 'broken.json'), '{not json')
	assert.equal(readState('broken.json', dir), undefined)
	assert.equal(readState('missing.json', dir), undefined)
	rmSync(dir, { recursive: true, force: true })
})

test('buildStatus exposes a rollback target when the last update landed here', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root10-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '2.0.0', dependencies: {} }))
	const state = mkdtempSync(join(tmpdir(), 'ga-state2-'))
	writeState('update.json', { from: '1.9.0', to: '2.0.0', at: '2026-01-01T00:00:00.000Z' }, state)
	const status = await buildStatus({ root, cwd: '/tmp', stateDir: state, fetchImpl: async () => ({ ok: false }) })
	assert.deepEqual(status.rollback, { version: '1.9.0', at: '2026-01-01T00:00:00.000Z' })
	// a record that does not point at the installed version is not offered
	writeState('update.json', { from: '1.9.0', to: '1.8.0' }, state)
	const other = await buildStatus({ root, cwd: '/tmp', stateDir: state, fetchImpl: async () => ({ ok: false }) })
	assert.equal(other.rollback, undefined)
	rmSync(root, { recursive: true, force: true })
	rmSync(state, { recursive: true, force: true })
})

test('registerStatusEndpoint: preview diffs the manifest without installing', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root11-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({
		name: 'dsh-general-agentics', version: '1.0.0', dependencies: { 'a-plugin': '^1.0.0' },
	}))
	let mounted
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : undefined) }
	const fetchImpl = async url => {
		if (String(url).includes('registry')) {
			if (String(url).endsWith('/latest')) return { ok: true, json: async () => ({ version: '1.1.0' }) }
			return { ok: true, json: async () => ({ name: 'dsh-general-agentics', version: '1.1.0', dependencies: { 'a-plugin': '^1.1.0', 'b-plugin': '^2.0.0' }, engines: { dsh: '>=0.2.1-rc.2' } }) }
		}
		return { ok: false }
	}
	registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl, stateDir: mkdtempSync(join(tmpdir(), 'ga-state3-')) })
	let captured
	await mounted.handler({ method: 'GET', url: '/api/general-agentics/status?preview=1', headers: {} }, {
		writeHead: status => { captured = { status } },
		end: body => { captured.body = JSON.parse(body) },
	})
	assert.equal(captured.status, 200)
	assert.equal(captured.body.to, '1.1.0')
	assert.deepEqual(captured.body.changes.map(c => `${c.name}:${c.kind}`), ['a-plugin:changed', 'b-plugin:added'])
	assert.equal(captured.body.enginesDsh, '>=0.2.1-rc.2')
	rmSync(root, { recursive: true, force: true })
})

test('registerStatusEndpoint: POST ?action=rollback installs the recorded version', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root12-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '2.0.0', dependencies: {} }))
	const state = mkdtempSync(join(tmpdir(), 'ga-state4-'))
	writeState('update.json', { from: '1.9.0', to: '2.0.0', at: '2026-01-01T00:00:00.000Z' }, state)
	let mounted
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => { asked.push(spec); return { application: 'applied' } },
	}
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : name === 'pluginManager' ? manager : undefined) }
	// after the swap the profile resolves to the fixture root, so installedVersion reads our 2.0.0
	registerStatusEndpoint(scope, {
		root, cwd: root, fetchImpl: async () => ({ ok: false }), stateDir: state,
		resolve: () => ({ dir: root }),
	})
	let csrf
	await mounted.handler({ method: 'GET', url: '/api/general-agentics/status?plugins=1', headers: {} }, {
		writeHead: () => {}, end: body => { csrf = JSON.parse(body).csrf },
	})
	// the fixture profile has no node_modules, so the rollback cannot verify; it must
	// still install the recorded version and report the verification failure honestly
	let captured
	await mounted.handler({
		method: 'POST', url: '/api/general-agentics/status?action=rollback',
		headers: { host: 'localhost', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': csrf },
	}, { writeHead: status => { captured = { status } }, end: body => { captured.body = JSON.parse(body) } })
	assert.deepEqual(asked, ['remove:dsh-general-agentics', 'dsh-general-agentics@1.9.0'])
	assert.equal(captured.body.code, 'rollback-verify-failed')
	rmSync(root, { recursive: true, force: true })
	rmSync(state, { recursive: true, force: true })
})

test('quiet hours parse and wrap around midnight', () => {
	assert.deepEqual(parseQuiet('night'), { from: 22, to: 8 })
	assert.deepEqual(parseQuiet('22-8'), { from: 22, to: 8 })
	assert.deepEqual(parseQuiet('9-18'), { from: 9, to: 18 })
	assert.equal(parseQuiet('off'), null)
	assert.equal(parseQuiet('nonsense'), null)
	assert.equal(parseQuiet('25-3'), null)
	const at = hour => new Date(2026, 0, 1, hour, 30, 0)
	assert.equal(quietHoursActive(parseQuiet('22-8'), at(23)), true)
	assert.equal(quietHoursActive(parseQuiet('22-8'), at(3)), true)
	assert.equal(quietHoursActive(parseQuiet('22-8'), at(12)), false)
	assert.equal(quietHoursActive(parseQuiet('9-18'), at(10)), true)
	assert.equal(quietHoursActive(parseQuiet('9-18'), at(18)), false)
	assert.equal(quietHoursActive(null, at(12)), false)
	assert.equal(quietHoursActive({ from: 7, to: 7 }, at(3)), true)
})

test('normalizeWindow accepts stored objects, strings and presets', () => {
	assert.deepEqual(normalizeWindow({ from: 9, to: 18 }), { from: 9, to: 18 })
	assert.deepEqual(normalizeWindow('22-8'), { from: 22, to: 8 })
	assert.deepEqual(normalizeWindow('night'), { from: 22, to: 8 })
	assert.equal(normalizeWindow(null), null)
	assert.equal(normalizeWindow({ from: 24, to: 3 }), null)
	assert.equal(normalizeWindow('[object Object]'), null)
})
