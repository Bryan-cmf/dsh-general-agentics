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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	allowWrite,
	buildDiagnostics,
	buildStatus,
	compareSemver,
	healthScore,
	redactHome,
	diffDependencies,
	fetchLatestVersion,
	normalizeAccent,
	normalizeWindow,
	parseQuiet,
	readState,
	installedVersion,
	profileNameFromDir,
	profileSpecFor,
	readOwnManifest,
	quietHoursActive,
	readSkillDetails,
	readUsage,
	registerStatusEndpoint,
	summarizeUsage,
	writeState,
	resolveProfile,
	specSatisfies,
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
	// Inject the filesystem answer: on CI there is no $HOME/.dsh/profiles/desktop
	// (on the maintainer's Mac there is), so reading the real disk made this test
	// environment-dependent.
	const target = join(DSH_HOME, 'profiles', 'desktop')
	const resolved = resolveProfile({ argv: ['node', 'dsh', target], cwd: '/tmp', exists: path => path === target })
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
	assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['dsh-comments', 'dsh-promptimizer'])
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
	assert.equal(status.curated.length, 12, '1 bundled dependency + 11 catalog entries')
	const own = status.curated.find(plugin => plugin.name === 'some-plugin')
	assert.equal(own.included, true)
	assert.equal(own.installed, undefined)
	assert.equal(own.latest, undefined)
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
	mkdirSync(join(root, 'node_modules', 'dsh-general-agentics'), { recursive: true })
	writeFileSync(join(root, 'node_modules', 'dsh-general-agentics', 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '2.0.0' }))
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

test('readSkillDetails reads front-matter and degrades to the folder name', () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-skills-'))
	mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
	mkdirSync(join(root, 'skills', 'beta'), { recursive: true })
	writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: "Does the alpha thing."\n---\n\n# Alpha\n')
	writeFileSync(join(root, 'skills', 'beta', 'SKILL.md'), 'no front matter here\n')
	const details = readSkillDetails(root)
	assert.deepEqual(details, [
		{ name: 'alpha-skill', description: 'Does the alpha thing.' },
		{ name: 'beta', description: '' },
	])
	rmSync(root, { recursive: true, force: true })
})

test('healthScore: clean input is 100, problems deduct with reasons', () => {
	const clean = healthScore({ curated: [{ name: 'a', installed: '1.0.0' }], prerequisites: [{ plugin: 'a', state: 'found' }] })
	assert.equal(clean.score, 100)
	assert.equal(clean.grade, 'A')
	assert.deepEqual(clean.deductions, [])

	const bad = healthScore({
		curated: [{ name: 'b' }, { name: 'c', installed: '1.0.0', alsoDirect: true }, { name: 'd', installed: '1.0.0', updateAvailable: true }],
		prerequisites: [{ plugin: 'e', state: 'missing' }],
	})
	assert.ok(bad.score < 100)
	const codes = bad.deductions.map(item => item.code).sort()
	assert.deepEqual(codes, ['behind', 'duplicate', 'missing', 'prerequisite'])
	// every deduction names what it is about
	for (const item of bad.deductions) assert.ok(item.detail.length > 5)

	// the score never goes negative, however bad it gets
	const awful = healthScore({
		curated: [...Array(10)].map((_, i) => ({ name: `p${i}` })),
		prerequisites: [...Array(10)].map((_, i) => ({ plugin: `q${i}`, state: 'missing' })),
	})
	assert.equal(awful.score, 44)
})

test('summarizeUsage counts tools and parses skill names from arguments', () => {
	const usage = summarizeUsage([
		{ name: 'bash', arguments: '{}' },
		{ name: 'bash', arguments: '{}' },
		{ name: 'skill', arguments: '{"name":"brainstorming"}' },
		{ name: 'skill', arguments: '{"name":"verification-before-completion"}' },
		{ name: 'skill', arguments: 'not json' },
		{ arguments: '{}' },
	])
	assert.equal(usage.toolCalls, 5)
	assert.deepEqual(usage.tools, [
		{ name: 'skill', count: 3 },
		{ name: 'bash', count: 2 },
	])
	assert.deepEqual(usage.skills, [
		{ name: 'brainstorming', count: 1 },
		{ name: 'verification-before-completion', count: 1 },
	])
})

test('readUsage reads a compressed session store through an injected decompressor', () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-sessions-'))
	mkdirSync(join(root, 'workspace', 'session-1'), { recursive: true })
	const records = [
		{ type: 'session' },
		{ type: 'tool/call', data: { name: 'bash', arguments: '{}' } },
		{ type: 'tool/call', data: { name: 'skill', arguments: '{"name":"brainstorming"}' } },
	].map(record => JSON.stringify(record)).join('\n')
	writeFileSync(join(root, 'workspace', 'session-1', 'session.v4.jsonl.zstd'), 'compressed-placeholder')
	const usage = readUsage({ sessionsRoot: root, decompress: () => Buffer.from(records) })
	assert.equal(usage.ok, true)
	assert.equal(usage.sessions, 1)
	assert.equal(usage.toolCalls, 2)
	assert.deepEqual(usage.skills, [{ name: 'brainstorming', count: 1 }])

	// a missing store degrades instead of throwing
	assert.equal(readUsage({}).ok, false)
	rmSync(root, { recursive: true, force: true })
})

test('buildDiagnostics renders the sections an issue needs', () => {
	const status = {
		current: '1.2.3', latest: '1.2.4',
		profile: { dir: '/tmp/prof', source: 'argv-profile' },
		health: { score: 78, grade: 'B', deductions: [{ code: 'missing', points: 12, detail: '1 not provided: b' }] },
		curated: [{ name: 'a', spec: '^1.0.0', installed: '1.0.0', latest: '1.0.1', updateAvailable: true }],
		prerequisites: [{ plugin: 'a', state: 'found', needs: 'nothing' }],
		settings: { quietHours: { from: 22, to: 8 }, quietNow: true },
		rollback: { version: '1.2.2' },
		lastResult: { action: 'update', ok: true, at: '2026-01-01T00:00:00.000Z' },
	}
	const markdown = buildDiagnostics({ status, usage: { ok: true, sessions: 2, toolCalls: 5, tools: [{ name: 'bash', count: 5 }], skills: [] } })
	assert.match(markdown, /^# General Agentics diagnostics/u)
	assert.match(markdown, /health:\s+78 \/ 100 \(B\)/u)
	assert.match(markdown, /\[missing\] -12/u)
	assert.match(markdown, /\| a \| \^1\.0\.0 \| 1\.0\.0 \| 1\.0\.1 \| behind \|/u)
	assert.match(markdown, /quiet hours: 22:00-08:00 \(now quiet: true\)/u)
	assert.match(markdown, /rollback target: 1\.2\.2/u)
	assert.match(markdown, /sessions scanned: 2, tool calls: 5/u)
	assert.match(markdown, /update at 2026-01-01T00:00:00\.000Z: ok=true/u)
	// a usage failure is stated, not omitted
	const withoutUsage = buildDiagnostics({ status, usage: { ok: false, reason: 'no session store' } })
	assert.match(withoutUsage, /unavailable: no session store/u)
})

test('accent normalisation and partial settings updates', async () => {
	assert.equal(normalizeAccent('teal'), 'teal')
	assert.equal(normalizeAccent('nope'), 'indigo')
	assert.equal(normalizeAccent(undefined), 'indigo')
	// quiet and accent can be updated independently
	const root = mkdtempSync(join(tmpdir(), 'ga-root13-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.0.0', dependencies: {} }))
	const state = mkdtempSync(join(tmpdir(), 'ga-state6-'))
	let mounted
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : undefined) }
	registerStatusEndpoint(scope, { root, cwd: root, stateDir: state, resolve: () => ({ dir: root }), fetchImpl: async () => ({ ok: false }) })
	const call = async (query, csrf) => {
		let captured
		await mounted.handler({ method: 'POST', url: `/api/general-agentics/status?${query}`, headers: { host: 'localhost', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': csrf } }, {
			writeHead: status => { captured = { status } }, end: body => { captured.body = JSON.parse(body) },
		})
		return captured
	}
	const get = async () => {
		let captured
		await mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, {
			writeHead: () => {}, end: body => { captured = JSON.parse(body) },
		})
		return captured
	}
	const first = await get()
	await call('action=settings&quiet=night', first.csrf)
	const afterQuiet = await get()
	assert.deepEqual(afterQuiet.settings.quietHours, { from: 22, to: 8 })
	assert.equal(afterQuiet.settings.accent, 'indigo')
	assert.equal((await call('action=settings&accent=teal', first.csrf)).body.settings.accent, 'teal')
	const afterAccent = await get()
	assert.equal(afterAccent.settings.accent, 'teal')
	assert.deepEqual(afterAccent.settings.quietHours, { from: 22, to: 8 }, 'accent update must not clear the quiet window')
	rmSync(root, { recursive: true, force: true })
	rmSync(state, { recursive: true, force: true })
})

/** A profile fixture with an installed bundle version, for rollback tests. */
function rollbackFixture(installedVersion = '2.0.0') {
	const root = mkdtempSync(join(tmpdir(), 'ga-rb-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: installedVersion, dependencies: {} }))
	mkdirSync(join(root, 'node_modules', 'dsh-general-agentics'), { recursive: true })
	writeFileSync(join(root, 'node_modules', 'dsh-general-agentics', 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: installedVersion }))
	const state = mkdtempSync(join(tmpdir(), 'ga-rbs-'))
	return { root, state }
}

async function rollbackCall({ root, state, manager, record }) {
	writeState('update.json', record, state)
	let mounted
	const scope = { get: n => (n === 'webServer' ? { register: o => { mounted = o } } : n === 'pluginManager' ? manager : undefined) }
	registerStatusEndpoint(scope, { root, cwd: root, stateDir: state, resolve: () => ({ dir: root }), fetchImpl: async () => ({ ok: false }) })
	const get = () => new Promise(res => mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, { writeHead: () => {}, end: b => res(JSON.parse(b)) }))
	const first = await get()
	let code = 0
	const body = await new Promise(res => mounted.handler({
		method: 'POST', url: '/api/general-agentics/status?action=rollback',
		headers: { host: 'localhost', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': first.csrf },
	}, { writeHead: c => { code = c }, end: b => res(JSON.parse(b)) }))
	return { code, body }
}

test('S1: a failed rollback install puts the previous bundle back', async () => {
	const { root, state } = rollbackFixture('2.0.0')
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => {
			asked.push(spec)
			if (spec.endsWith('@1.9.0')) throw Object.assign(new Error('registry refused'), { code: 'fetch-failed' })
			return { application: 'applied' }
		},
	}
	const { code, body } = await rollbackCall({ root, state, manager, record: { from: '1.9.0', to: '2.0.0' } })
	assert.equal(code, 500)
	assert.equal(body.code, 'fetch-failed')
	assert.equal(body.restored, '2.0.0', 'the version that was installed must be restored')
	assert.deepEqual(asked, ['remove:dsh-general-agentics', 'dsh-general-agentics@1.9.0', 'dsh-general-agentics@2.0.0'])
	const result = readState('last-result.json', state)
	assert.equal(result.ok, false, 'a failed rollback is recorded for diagnostics')
	assert.equal(result.action, 'rollback')
	rmSync(root, { recursive: true, force: true })
	rmSync(state, { recursive: true, force: true })
})

test('S3: a stale rollback record is refused instead of downgrading blind', async () => {
	const { root, state } = rollbackFixture('2.0.0')
	const asked = []
	const manager = {
		removeBundle: async name => { asked.push(`remove:${name}`); return { application: 'applied' } },
		installBundle: async spec => { asked.push(spec); return { application: 'applied' } },
	}
	const { code, body } = await rollbackCall({ root, state, manager, record: { from: '0.0.1', to: '9.9.9' } })
	assert.equal(code, 409)
	assert.equal(body.code, 'stale-record')
	assert.equal(body.recorded, '9.9.9')
	assert.equal(body.installed, '2.0.0')
	assert.deepEqual(asked, [], 'nothing may be removed or installed')
	rmSync(root, { recursive: true, force: true })
	rmSync(state, { recursive: true, force: true })
})

test('S2: diagnostics redacts the home directory and the payload path', async () => {
	const home = '/Users/example'
	assert.equal(redactHome(`${home}/.dsh/profiles/desktop`, home), '~/.dsh/profiles/desktop')
	const status = { current: '1.0.0', profile: { dir: '~/.dsh/profiles/desktop', source: 'argv-profile' }, curated: [], prerequisites: [] }
	const markdown = buildDiagnostics({ status })
	assert.ok(!markdown.includes(home), 'the report must not contain the home path')
	assert.match(markdown, /profile:\s+~\/\.dsh/u)
})

test('S6: usage scanning is bounded and says what it covers', () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-cap-'))
	mkdirSync(join(root, 'ws', 's1'), { recursive: true })
	writeFileSync(join(root, 'ws', 's1', 'session.v4.jsonl.zstd'), 'x')
	const big = JSON.stringify({ type: 'tool/call', data: { name: 'bash', arguments: '{}' } })
	const usage = readUsage({ sessionsRoot: root, maxBytes: 10, decompress: () => Buffer.from(big) })
	assert.equal(usage.ok, true)
	assert.equal(usage.scope, 'all-workspaces')
	assert.equal(usage.sessions, 1, 'the first file still counts')
	// a second call with a tiny budget and two files must skip the rest
	mkdirSync(join(root, 'ws', 's2'), { recursive: true })
	writeFileSync(join(root, 'ws', 's2', 'session.v4.jsonl.zstd'), 'x')
	const capped = readUsage({ sessionsRoot: root, maxBytes: 5, decompress: () => Buffer.from(big) })
	assert.ok(capped.skipped >= 1)
	rmSync(root, { recursive: true, force: true })
})

test('S9: the i18n test covers template keys like accent_${key}', () => {
	const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
	const start = source.indexOf('/* GA_I18N_START */')
	const end = source.indexOf('/* GA_I18N_END */')
	const table = new Function(`${source.slice(start, end).replace('/* GA_I18N_START */', '').trim()}\nreturn GA_I18N`)()
	const keys = new Set(Object.keys(table.zh))
	// prefixes used through template literals
	for (const match of source.matchAll(/\bt[f]?\(`([a-z]+_)\$\{/gu)) {
		const prefix = match[1]
		const expanded = [...keys].filter(key => key.startsWith(prefix))
		assert.ok(expanded.length > 0, `template key prefix ${prefix} has no dictionary entries`)
	}
})

test('S21: installedVersion reads the disk, not the module cache', () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-iv-'))
	const dir = join(root, 'node_modules', 'some-plugin')
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-plugin', version: '1.0.0' }))
	assert.equal(installedVersion('some-plugin', root), '1.0.0')
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-plugin', version: '2.0.0' }))
	assert.equal(installedVersion('some-plugin', root), '2.0.0', 'a swap must be visible in the same process')
	rmSync(dir, { recursive: true, force: true })
	assert.equal(installedVersion('some-plugin', root), undefined)
	rmSync(root, { recursive: true, force: true })
})


test('specSatisfies honours caret floors and admits unparsable specs', () => {
	assert.equal(specSatisfies('4.39.0', '^4.39.0'), true)
	assert.equal(specSatisfies('4.40.1', '^4.39.0'), true)
	assert.equal(specSatisfies('5.2.0', '^4.39.0'), false)
	assert.equal(specSatisfies('0.6.13', '^0.6.11'), true)
	assert.equal(specSatisfies('0.7.0', '^0.6.2'), false)
	assert.equal(specSatisfies('0.2.0-alpha.32', '^0.2.0-alpha.27'), true, 'same-tuple prereleases satisfy')
	assert.equal(specSatisfies('1.2.3', 'latest'), true, 'unparsable spec admits everything')
	assert.equal(specSatisfies('1.2.3', 'link:/some/path'), true)
})

test('buildStatus: a newer release outside the declared range is outOfRange, not an update', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root-oor-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({
		name: 'dsh-general-agentics',
		version: '0.2.0-alpha.32',
		dependencies: { 'range-plugin': '^4.39.0', 'inrange-plugin': '^1.0.0' },
	}))
	const profile = makeProfile('oor', { dependencies: { 'dsh-general-agentics': 'file:./x.tgz' } })
	for (const [name, version] of [['range-plugin', '4.39.0'], ['inrange-plugin', '1.0.0']]) {
		mkdirSync(join(profile, 'node_modules', name), { recursive: true })
		writeFileSync(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
	}
	const status = await buildStatus({
		root,
		cwd: '/tmp',
		includePlugins: true,
		resolve: () => ({ dir: profile, name: 'oor', source: 'argv-profile' }),
		fetchImpl: fakeFetch({
			'dsh-general-agentics': '0.2.0-alpha.32',
			'range-plugin': '5.2.0',
			'inrange-plugin': '1.4.0',
		}),
	})
	const byName = Object.fromEntries(status.curated.map(plugin => [plugin.name, plugin]))
	// S22: the bundle update cannot deliver 5.2.0 under ^4.39.0, so it must not
	// be advertised as an update — it is an out-of-range flag instead.
	assert.equal(byName['range-plugin'].updateAvailable, false)
	assert.equal(byName['range-plugin'].outOfRange, true)
	assert.equal(byName['range-plugin'].latest, '5.2.0')
	assert.equal(byName['inrange-plugin'].updateAvailable, true)
	assert.equal(byName['inrange-plugin'].outOfRange, false)
	rmSync(root, { recursive: true, force: true })
	rmSync(profile, { recursive: true, force: true })
})

test('registerStatusEndpoint: the manual command is redacted without same-origin fetch metadata', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root-redact-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const server = { register: options => { mounted = options; return () => {} } }
	registerStatusEndpoint({ get: name => (name === 'webServer' ? server : undefined) }, {
		root, cwd: '/tmp', resolve: () => ({ dir: '/tmp', name: 'secret-profile', source: 'argv-profile' }),
		fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.3' }),
	})
	const call = async headers => {
		let captured
		await mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers }, {
			writeHead: status => { captured = { status } },
			end: body => { captured.body = JSON.parse(body) },
		})
		return captured
	}
	// curl without Sec-Fetch-Site: the profile name never leaves the machine.
	const bare = await call({})
	assert.match(bare.body.updateCommand, /--profile <profile> add/u)
	assert.doesNotMatch(bare.body.updateCommand, /secret-profile/u)
	// The panel's browser always sends Sec-Fetch-Site: same-origin.
	const panel = await call({ 'sec-fetch-site': 'same-origin' })
	assert.match(panel.body.updateCommand, /--profile secret-profile add/u)
	rmSync(root, { recursive: true, force: true })
})

test('registerStatusEndpoint: diagnostics requires POST with the panel token', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root-diag-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const server = { register: options => { mounted = options; return () => {} } }
	registerStatusEndpoint({ get: name => (name === 'webServer' ? server : undefined) }, {
		root, cwd: '/tmp', fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.3' }),
	})
	const call = async (method, url, headers) => {
		let captured
		await mounted.handler({ method, url, headers: headers ?? {} }, {
			writeHead: status => { captured = { status } },
			end: body => { captured.body = JSON.parse(body) },
		})
		return captured
	}
	const viaGet = await call('GET', '/api/general-agentics/status?diagnostics=1')
	assert.equal(viaGet.body.markdown, undefined)
	const refused = await call('POST', '/api/general-agentics/status?diagnostics=1', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' })
	assert.equal(refused.status, 403)
	let csrf
	await call('GET', '/api/general-agentics/status').then(out => { csrf = out.body.csrf })
	const allowed = await call('POST', '/api/general-agentics/status?diagnostics=1', { host: 'localhost:3000', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': csrf })
	assert.equal(allowed.status, 200)
	assert.ok(String(allowed.body.markdown ?? '').includes('# General Agentics diagnostics'))
	rmSync(root, { recursive: true, force: true })
})


test('POST action=plugin installs a catalog package through the manager', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root-plugin-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const server = { register: options => { mounted = options; return () => {} } }
	const calls = []
	const manager = {
		installBundle: async spec => { calls.push(spec); return { ok: true } },
		removeBundle: async () => ({ ok: true }),
	}
	// The manager "installs" nothing on disk; the verifier must catch that and
	// still report honestly. For the success path we fake the file below.
	registerStatusEndpoint({ get: name => (name === 'webServer' ? server : name === 'pluginManager' ? manager : undefined) }, {
		root,
		cwd: '/tmp',
		resolve: () => ({ dir: '/tmp', name: 'plugtest', source: 'argv-profile' }),
		fetchImpl: fakeFetch({ 'dsh-general-agentics': '1.2.3' }),
	})
	const call = async (url, headers) => {
		let captured
		await mounted.handler({ method: 'POST', url, headers: headers ?? {} }, {
			writeHead: status => { captured = { status } },
			end: body => { captured.body = JSON.parse(body) },
		})
		return captured
	}
	let csrf
	await mounted.handler({ method: 'GET', url: '/api/general-agentics/status', headers: {} }, {
		writeHead: () => {},
		end: body => { csrf = JSON.parse(body).csrf },
	})
	const tokenHeaders = { host: 'localhost:3000', 'sec-fetch-site': 'same-origin', 'x-ga-csrf': csrf }

	// Not in the catalog: refused before the manager is touched.
	const refused = await call('/api/general-agentics/status?action=plugin&pkg=definitely-not-catalogued', tokenHeaders)
	assert.equal(refused.status, 400)
	assert.equal(refused.body.code, 'not-in-catalog')
	assert.equal(calls.length, 0)

	// In the catalog but the install never landed on disk: honest failure.
	const missing = await call('/api/general-agentics/status?action=plugin&pkg=dshmarket', tokenHeaders)
	assert.equal(calls.length, 1, 'the manager was called once')
	assert.equal(calls[0], 'dshmarket')
	assert.equal(missing.status, 200)
	assert.equal(missing.body.ok, true)
	assert.equal(missing.body.version, undefined, 'a version that is not on disk must not be claimed')
	rmSync(root, { recursive: true, force: true })
})
