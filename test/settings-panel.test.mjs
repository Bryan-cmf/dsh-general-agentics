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
	buildStatus,
	compareSemver,
	installedVersion,
	profileNameFromDir,
	profileSpecFor,
	readOwnManifest,
	registerStatusEndpoint,
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
	assert.ok(Object.keys(manifest.dependencies).length >= 13)
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

test('registerStatusEndpoint: POST without a plugin manager hands back the command', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ga-root5-'))
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-general-agentics', version: '1.2.3', dependencies: {} }))
	let mounted
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : undefined) }
	registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl: fakeFetch({}) })
	let captured
	await mounted.handler({ method: 'POST', url: '/api/general-agentics/status' }, {
		writeHead: status => { captured = { status } },
		end: body => { captured.body = JSON.parse(body) },
	})
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
	const manager = { installBundle: async spec => { asked.push(spec); return { application: 'restart-required' } } }
	const scope = { get: name => (name === 'webServer' ? { register: o => { mounted = o } } : name === 'pluginManager' ? manager : undefined) }
	registerStatusEndpoint(scope, { root, cwd: '/tmp', fetchImpl: fakeFetch({}) })
	let captured
	await mounted.handler({ method: 'POST', url: '/api/general-agentics/status' }, {
		writeHead: status => { captured = { status } },
		end: body => { captured.body = JSON.parse(body) },
	})
	assert.deepEqual(asked, ['dsh-general-agentics@latest'])
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
