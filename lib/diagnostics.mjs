/**
 * Observability pieces: the health score (what is wrong, at a glance), a
 * copyable diagnostics report, and usage insights read from the local session
 * log.
 *
 * The session store is read-only here and only ever counted — no message text
 * leaves this module. The format is versioned and internal to DSH, so every
 * step degrades instead of throwing: no store, no zstd, unreadable line — the
 * report still renders, with the reason stated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** A plugin's `installed`/`alsoDirect`/`updateAvailable` flags in, one score out. */
export function healthScore({ curated = [], prerequisites = [] } = {}) {
	const deductions = []
	// Since 0.3.0 `curated` mixes included plugins (bundle-owned) and catalog
	// entries (optional, user-installed). A catalog entry that is not installed
	// is a choice, not a problem, so only included plugins count here.
	const included = curated.filter(plugin => plugin.included !== false)
	const missing = included.filter(plugin => plugin.installed === undefined)
	const duplicates = included.filter(plugin => plugin.alsoDirect === true)
	const behind = curated.filter(plugin => plugin.updateAvailable === true)
	const unmet = prerequisites.filter(item => item.state === 'missing')

	const add = (code, points, detail) => {
		if (points <= 0) return
		deductions.push({ code, points, detail })
	}
	add('missing', Math.min(36, missing.length * 12),
		missing.length === 0 ? 'none' : `${missing.length} not provided by this profile: ${missing.map(p => p.name).join(', ')}`)
	add('duplicate', Math.min(24, duplicates.length * 8),
		duplicates.length === 0 ? 'none' : `${duplicates.length} installed twice: ${duplicates.map(p => p.name).join(', ')}`)
	add('prerequisite', Math.min(20, unmet.length * 10),
		unmet.length === 0 ? 'none' : `${unmet.length} missing prerequisite(s): ${unmet.map(p => p.plugin).join(', ')}`)
	add('behind', Math.min(10, behind.length * 2),
		behind.length === 0 ? 'none' : `${behind.length} behind the registry`)

	const score = Math.max(0, 100 - deductions.reduce((total, item) => total + item.points, 0))
	const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : 'D'
	return { score, grade, deductions: deductions.filter(item => item.detail !== 'none') }
}

/**
 * Count tool and skill usage from `tool/call` records.
 * @param {{name?: string, arguments?: string}[]} calls
 */
export function summarizeUsage(calls) {
	const tools = new Map()
	const skills = new Map()
	for (const call of calls) {
		const name = call?.name
		if (typeof name !== 'string') continue
		tools.set(name, (tools.get(name) ?? 0) + 1)
		if (name !== 'skill') continue
		let parsed
		try {
			parsed = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
		} catch {
			continue
		}
		const skill = parsed?.name
		if (typeof skill === 'string') skills.set(skill, (skills.get(skill) ?? 0) + 1)
	}
	const sort = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
	return {
		toolCalls: [...tools.values()].reduce((total, count) => total + count, 0),
		tools: sort(tools),
		skills: sort(skills),
	}
}

/**
 * Read the newest session files and summarise tool usage. Bounded on purpose:
 * the panel asks for this while the user waits.
 */
export function readUsage({ sessionsRoot, limit = 12, maxBytes = 64 * 1024 * 1024, decompress = zstdDecompressSync } = {}) {
	if (sessionsRoot === undefined) return { ok: false, reason: 'no session store' }
	if (typeof decompress !== 'function') return { ok: false, reason: 'zstd unavailable on this Node' }
	let workspaces = []
	try {
		workspaces = readdirSync(sessionsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
	} catch {
		return { ok: false, reason: 'session store unreadable' }
	}

	const files = []
	for (const workspace of workspaces) {
		const folder = join(sessionsRoot, workspace)
		let sessions = []
		try {
			sessions = readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
		} catch {
			continue
		}
		for (const session of sessions) {
			const file = join(folder, session, 'session.v4.jsonl.zstd')
			try {
				files.push({ file, mtime: statSync(file).mtimeMs })
			} catch {
				/* not every directory is a session */
			}
		}
	}
	files.sort((a, b) => b.mtime - a.mtime)

	const calls = []
	let scanned = 0
	let skipped = 0
	let decompressed = 0
	for (const entry of files.slice(0, limit)) {
		if (decompressed >= maxBytes) { skipped++; continue }
		let raw
		try {
			const buffer = readFileSync(entry.file)
			if (buffer.length > 32 * 1024 * 1024) { skipped++; continue }
			raw = decompress(buffer).toString('utf8')
			decompressed += raw.length
		} catch {
			skipped++
			continue
		}
		scanned++
		for (const line of raw.split('\n')) {
			if (!line.includes('"tool/call"')) continue
			try {
				const record = JSON.parse(line)
				if (record?.type === 'tool/call') calls.push(record.data ?? {})
			} catch {
				/* a torn last line is normal while a session is live */
			}
		}
	}

	// S6: say what the numbers cover — this is every workspace on the machine,
	// not only the current profile, and skipped files explain a smaller sample.
	return { ok: true, sessions: scanned, skipped, scope: 'all-workspaces', ...summarizeUsage(calls) }
}

/** Remove the local user's home path from anything that will be shared. */
export function redactHome(text, home = homedir()) {
	if (typeof text !== 'string' || typeof home !== 'string' || home === '') return text
	return text.split(home).join('~')
}

/** Markdown a user can paste into an issue. */
export function buildDiagnostics({ status, usage, generatedAt = new Date().toISOString(), home = homedir() } = {}) {
	const lines = []
	const score = status?.health
	lines.push(`# General Agentics diagnostics`)
	lines.push('')
	lines.push(`generated: ${generatedAt}`)
	lines.push(`bundle:    ${status?.current ?? 'unknown'} (latest ${status?.latest ?? 'unknown'})`)
	lines.push(`profile:   ${status?.profile?.dir ?? 'unknown'} (${status?.profile?.source ?? 'unknown'})`)
	lines.push(`health:    ${score?.score ?? '?'} / 100 (${score?.grade ?? '?'})`)
	lines.push('')

	lines.push('## What needs attention')
	if ((score?.deductions ?? []).length === 0) lines.push('- nothing')
	for (const item of score?.deductions ?? []) lines.push(`- [${item.code}] -${item.points}: ${item.detail}`)
	lines.push('')

	lines.push('## Curated plugins')
	lines.push('| plugin | declared | installed | registry | flags |')
	lines.push('| --- | --- | --- | --- | --- |')
	for (const plugin of status?.curated ?? []) {
		const flags = [
			plugin.installed === undefined ? 'missing' : '',
			plugin.alsoDirect === true ? 'also-direct' : '',
			plugin.updateAvailable === true ? 'behind' : '',
		].filter(Boolean).join(',') || '-'
		lines.push(`| ${plugin.name} | ${plugin.spec ?? '-'} | ${plugin.installed ?? '-'} | ${plugin.latest ?? '-'} | ${flags} |`)
	}
	lines.push('')

	lines.push('## Prerequisites')
	for (const item of status?.prerequisites ?? []) lines.push(`- ${item.plugin}: ${item.state} — ${item.needs}`)
	if ((status?.prerequisites ?? []).length === 0) lines.push('- none declared')
	lines.push('')

	lines.push('## Settings')
	lines.push(`- quiet hours: ${status?.settings?.quietHours === null || status?.settings?.quietHours === undefined ? 'off' : `${String(status.settings.quietHours.from).padStart(2, '0')}:00-${String(status.settings.quietHours.to).padStart(2, '0')}:00`} (now quiet: ${status?.settings?.quietNow === true})`)
	lines.push(`- rollback target: ${status?.rollback?.version ?? 'none'}`)
	lines.push('')

	lines.push('## Usage (recent sessions, counts only)')
	if (usage === undefined || usage === null) lines.push('- not collected')
	else if (usage.ok !== true) lines.push(`- unavailable: ${usage.reason}`)
	else {
		lines.push(`- scope: ${usage.scope ?? 'unknown'}${usage.skipped > 0 ? `, ${usage.skipped} file(s) skipped` : ''}`)
		lines.push(`- sessions scanned: ${usage.sessions}, tool calls: ${usage.toolCalls}`)
		lines.push(`- top tools: ${usage.tools.slice(0, 6).map(item => `${item.name}×${item.count}`).join(', ') || 'none'}`)
		lines.push(`- skills used: ${usage.skills.map(item => `${item.name}×${item.count}`).join(', ') || 'none'}`)
	}
	lines.push('')

	lines.push('## Last write')
	if (status?.lastResult === undefined) lines.push('- none recorded')
	else lines.push(`- ${status.lastResult.action ?? 'update'} at ${status.lastResult.at ?? '?'}: ok=${status.lastResult.ok} ${status.lastResult.code ?? ''} ${status.lastResult.error ?? ''}`.trim())

	// S2: a diagnostics report is meant to be pasted into an issue; it must not
	// carry the absolute path (and therefore the account name) of the reporter.
	return `${redactHome(lines.join('\n'), home)}\n`
}
