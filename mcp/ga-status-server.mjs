#!/usr/bin/env node
/**
 * ga-status — General Agentics bundle status MCP server (stdio).
 *
 * A dependency-free Model Context Protocol server that exposes one tool,
 * `ga_bundle_info`, reporting this bundle's identity and contents. It exists
 * to demonstrate the MCP pre-configuration story (one
 * `@deepseek-ai/dsh-mcp-client` row per server in cordis.patch.yml) and to
 * give users — and the agent itself — a way to verify the installation:
 * the model can call `mcp__ga-status__ga_bundle_info` and cite the result.
 *
 * Wire format: MCP over stdio = one JSON-RPC 2.0 message per line.
 * Logs go to stderr only (stdout is the protocol channel).
 */
import { createInterface } from 'node:readline'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
}

function listSkills() {
	try {
		const dir = join(ROOT, 'skills')
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

function bundleInfoText() {
	const pkg = readJson(join(ROOT, 'package.json')) ?? {}
	const curated = Object.keys(pkg.dependencies ?? {})
	const lines = [
		'General Agentics distribution bundle for DeepSeek Harness (DSH)',
		`package: ${pkg.name ?? 'unknown'}@${pkg.version ?? 'unknown'}`,
		`product: General Agentics (GA)`,
		`bundled skills: ${listSkills().join(', ') || '(none)'}`,
		`curated plugin dependencies: ${curated.join(', ') || '(none)'}`,
		`brand: sidebar mark/wordmark, hero mark, theme tokens, tab title, favicon`,
		`attribution: Built on DeepSeek Harness (DSH), MIT licensed`,
	]
	return lines.join('\n')
}

const TOOLS = [
	{
		name: 'ga_bundle_info',
		description:
			'Report the installed General Agentics bundle identity, version, bundled skills, curated plugin dependencies, and the brand surfaces it occupies. Use whenever the user asks what this deployment is, or to verify the bundle finished installing.',
		inputSchema: { type: 'object', properties: {}, required: [] },
	},
]

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

function handleMessage(message) {
	if (message === null || typeof message !== 'object' || typeof message.method !== 'string') return
	const { id, method, params } = message
	const isRequest = id !== undefined

	switch (method) {
		case 'initialize':
			reply(id, {
				protocolVersion: params?.protocolVersion ?? '2024-11-05',
				capabilities: { tools: {} },
				serverInfo: { name: 'ga-status', version: '0.1.0' },
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
			if (name !== 'ga_bundle_info') {
				if (isRequest) fail(id, -32602, `unknown tool: ${name}`)
				return
			}
			reply(id, { content: [{ type: 'text', text: bundleInfoText() }], isError: false })
			return
		}
		default:
			if (isRequest) fail(id, -32601, `method not found: ${method}`)
	}
}

process.stderr.write('ga-status: ready (stdio MCP server for the General Agentics bundle)\n')
createInterface({ input: process.stdin }).on('line', line => {
	if (line.trim() === '') return
	try {
		handleMessage(JSON.parse(line))
	} catch (error) {
		process.stderr.write(`ga-status: dropped malformed message: ${String(error)}\n`)
	}
})
