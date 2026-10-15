#!/usr/bin/env node
/**
 * ga-status — General Agentics bundle status MCP server (stdio).
 *
 * A dependency-free Model Context Protocol server exposing this bundle's
 * identity plus a read-only health check. It exists to demonstrate the MCP
 * pre-configuration story (one `@deepseek-ai/dsh-mcp-client` row per server
 * in cordis.patch.yml) and to answer two questions a user (or an agent acting
 * for them) always ends up asking:
 *
 *   1. "What am I running?"            → ga_bundle_info
 *   2. "Why is part of it missing?"    → ga_health_check
 *
 * The health check exists because the two most common "some plugins did not
 * appear" causes are invisible from the UI: a curated plugin that the profile
 * ALSO installs directly (two rows for one plugin — see docs/ops-lessons.md
 * rules 12 and 17), and a plugin whose external prerequisite (a CLI, a
 * venv, an API credential) is absent. Both are reported with the action to
 * take, so the answer is "install X" rather than "it is broken".
 *
 * Read-only by construction: it only reads this package, the profile manifest
 * beside the process working directory, and the PATH. It never writes.
 *
 * Wire format: MCP over stdio = one JSON-RPC 2.0 message per line.
 * Logs go to stderr only (stdout is the protocol channel).
 */
import { createInterface } from 'node:readline'
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** External prerequisites that cannot ride along in an npm package. */
const EXTERNAL_REQUIREMENTS = [
	{
		match: /dsh-browser-use/u,
		needs: 'the `uv` CLI — the plugin provisions a Python virtualenv (~25MB) on first use',
		probe: 'uv',
	},
	{
		match: /modlens/u,
		needs: 'the Antigravity CLI — modlens uses it as its vision backend (not probed; install per its README)',
		probe: null,
	},
	{
		match: /dsh-im/u,
		needs: 'an IM application credential (Feishu / WeChat / Slack / …) — without one it only logs',
		probe: null,
	},
	{
		match: /dsh-mobile/u,
		needs: 'a free TCP port (default 3443) — a second dsh-mobile gateway on the same machine collides',
		probe: null,
	},
]

export function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
}

export function listSkills(root = ROOT) {
	try {
		const dir = join(root, 'skills')
		return readdirSync(dir).filter(entry => {
			try {
				return statSync(join(dir, entry, 'SKILL.md')).isFile()
			} catch {
				return false
			}
		})
	} catch {
		return []
	}
}

/** Curated plugin dependencies declared by this bundle's manifest. */
export function curatedPlugins(root = ROOT) {
	const pkg = readJson(join(root, 'package.json')) ?? {}
	return Object.keys(pkg.dependencies ?? {})
}

/**
 * Read the profile manifest. The host spawns this server with cwd = the
 * profile directory (measured), which is the primary source. When cwd holds
 * THIS package instead — a manual run from the repo — fall back to the install
 * path: this file lives at <profile>/node_modules/<pkg>/, so two levels above
 * its own directory is the profile.
 */
export function readProfileManifest(cwd = process.cwd(), root = ROOT) {
	const shape = (dir, source, manifest) => ({
		dir,
		source,
		dependencies: Object.keys(manifest.dependencies ?? {}),
		bundles: manifest.dsh?.profile?.bundles ?? [],
	})
	const ownName = readJson(join(root, 'package.json'))?.name
	const here = readJson(join(cwd, 'package.json'))
	if (here !== undefined && (ownName === undefined || here.name !== ownName)) {
		return shape(cwd, 'cwd', here)
	}
	const derived = dirname(dirname(root))
	const installed = readJson(join(derived, 'package.json'))
	// Only trust the derivation when it really looks like a DSH profile; a
	// stray package.json two levels up must not be reported as one.
	const looksLikeProfile = installed !== undefined && (
		String(installed.name ?? '').startsWith('dsh-profile') ||
		Object.keys(installed.dependencies ?? {}).includes(String(ownName ?? ''))
	)
	return looksLikeProfile ? shape(derived, 'install-path', installed) : undefined
}

/**
 * Curated plugins the profile also installs directly. Each such plugin
 * activates twice, and before the ga- prefixed row ids it also made every
 * settings write fail. Removing the direct install is the fix.
 */
export function duplicatePlugins(curated, profile) {
	if (profile === undefined) return []
	const direct = new Set([...profile.dependencies, ...profile.bundles])
	return curated.filter(name => direct.has(name))
}

/** Does an executable of this name exist on PATH? */
export function probeCommand(name, pathValue = process.env.PATH ?? '') {
	let found = false
	for (const dir of pathValue.split(delimiter)) {
		if (dir === '') continue
		try {
			accessSync(join(dir, name), constants.X_OK)
			found = true
			break
		} catch {
			/* keep looking */
		}
	}
	return found
}

/** Prerequisite lines for the plugins this bundle curates. */
export function prerequisiteReport(curated, probe = probeCommand) {
	const lines = []
	for (const plugin of curated) {
		for (const requirement of EXTERNAL_REQUIREMENTS) {
			if (!requirement.match.test(plugin)) continue
			const state = requirement.probe === null
				? 'not probed'
				: probe(requirement.probe) ? 'found on PATH' : `MISSING (${requirement.probe})`
			lines.push(`${plugin}: ${requirement.needs} [${state}]`)
		}
	}
	return lines
}

export function bundleInfoText(root = ROOT) {
	const pkg = readJson(join(root, 'package.json')) ?? {}
	const curated = curatedPlugins(root)
	return [
		'General Agentics distribution bundle for DeepSeek Harness (DSH)',
		`package: ${pkg.name ?? 'unknown'}@${pkg.version ?? 'unknown'}`,
		`product: General Agentics (GA)`,
		`bundled skills: ${listSkills(root).join(', ') || '(none)'}`,
		`curated plugin dependencies: ${curated.join(', ') || '(none)'}`,
		`brand: sidebar mark/wordmark, hero mark, theme tokens, tab title, favicon, START HERE strip`,
		`attribution: Built on DeepSeek Harness (DSH), MIT licensed`,
	].join('\n')
}

/**
 * Read-only health report. Every finding carries the action to take, so a
 * reader can tell "missing prerequisite" apart from "actually broken".
 */
export function healthReport({ root = ROOT, cwd = process.cwd(), probe = probeCommand } = {}) {
	const pkg = readJson(join(root, 'package.json')) ?? {}
	const curated = curatedPlugins(root)
	const profile = readProfileManifest(cwd)
	const duplicates = duplicatePlugins(curated, profile)
	const lines = [
		`bundle: ${pkg.name ?? 'unknown'}@${pkg.version ?? 'unknown'}`,
		`node: ${process.execPath}`,
		`cwd: ${cwd}`,
		`curated plugins: ${curated.length}`,
		`bundled skills: ${listSkills(root).length}`,
	]

	lines.push('', 'profile:')
	if (profile === undefined) {
		lines.push(`  manifest not found at ${join(cwd, 'package.json')} — duplicate detection skipped`)
	} else {
		lines.push(`  dir: ${profile.dir} (via ${profile.source})`)
		lines.push(`  direct dependencies: ${profile.dependencies.length}`)
		lines.push(`  bundles: ${profile.bundles.length}`)
	}

	lines.push('', 'duplicate installs:')
	if (profile === undefined) {
		lines.push('  (unknown — profile manifest not readable)')
	} else if (duplicates.length === 0) {
		lines.push('  none — every curated plugin is provided by this bundle alone')
	} else {
		lines.push(`  ${duplicates.length} curated plugin(s) are ALSO installed directly by this profile:`)
		for (const name of duplicates) lines.push(`    - ${name}`)
		lines.push('  each one activates twice. Fix: remove the direct install from this profile')
		lines.push('  (Plugins page → Remove), then restart. See docs/ops-lessons.md rules 12 and 17.')
	}

	lines.push('', 'external prerequisites (not shippable in an npm package):')
	const prerequisites = prerequisiteReport(curated, probe)
	if (prerequisites.length === 0) lines.push('  (none for the curated set)')
	else for (const line of prerequisites) lines.push(`  - ${line}`)

	lines.push('', 'notes:')
	lines.push('  - skills and MCP tools appear in NEW sessions only; a plugin refresh (Cmd+R) is needed for the browser half')
	lines.push('  - Agency expert teams are disabled by default (upstream opt-in): enable them in Settings → Experts')

	return lines.join('\n')
}

const TOOLS = [
	{
		name: 'ga_bundle_info',
		description:
			'Report the installed General Agentics bundle identity, version, bundled skills, curated plugin dependencies, and the brand surfaces it occupies. Use whenever the user asks what this deployment is, or to verify the bundle finished installing.',
		inputSchema: { type: 'object', properties: {}, required: [] },
	},
	{
		name: 'ga_health_check',
		description:
			'Read-only diagnostic for a General Agentics deployment. Reports the bundle version, whether any curated plugin is also installed directly by the profile (which makes it activate twice and used to break settings writes), and which curated plugins are missing an external prerequisite such as a CLI or a credential. Use when the user reports that some plugins, tools or features did not appear after installing.',
		inputSchema: { type: 'object', properties: {}, required: [] },
	},
]

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

export function handleMessage(message) {
	if (message === null || typeof message !== 'object' || typeof message.method !== 'string') return
	const { id, method, params } = message
	const isRequest = id !== undefined

	switch (method) {
		case 'initialize':
			reply(id, {
				protocolVersion: params?.protocolVersion ?? '2024-11-05',
				capabilities: { tools: {} },
				serverInfo: { name: 'ga-status', version: '0.2.0' },
			})
			return
		case 'notifications/initialized':
		case 'notifications/cancelled':
			return // notifications take no response
		case 'ping':
			reply(id, {})
			return
		case 'tools/list':
			reply(id, { tools: TOOLS })
			return
		case 'tools/call': {
			const name = params?.name
			if (name === 'ga_bundle_info') {
				reply(id, { content: [{ type: 'text', text: bundleInfoText() }], isError: false })
				return
			}
			if (name === 'ga_health_check') {
				reply(id, { content: [{ type: 'text', text: healthReport() }], isError: false })
				return
			}
			if (isRequest) fail(id, -32602, `unknown tool: ${name}`)
			return
		}
		default:
			if (isRequest) fail(id, -32601, `method not found: ${method}`)
	}
}

/** Start the stdio loop only when run as a program, so tests can import above.
 *  The path must be RESOLVED first: the host passes an absolute path, but a
 *  manual `node mcp/ga-status-server.mjs` arrives relative — comparing the raw
 *  argv value against import.meta.url would then start nothing at all, with no
 *  error to explain the silence. */
const isEntryPoint = process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
	process.stderr.write('ga-status: ready (stdio MCP server for the General Agentics bundle)\n')
	createInterface({ input: process.stdin }).on('line', line => {
		if (line.trim() === '') return
		try {
			handleMessage(JSON.parse(line))
		} catch (error) {
			process.stderr.write(`ga-status: dropped malformed message: ${String(error)}\n`)
		}
	})
}
