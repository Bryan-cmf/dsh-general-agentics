/**
 * Health checks shared by the settings panel (host half) and the MCP server.
 *
 * One source of truth: the panel must be able to say the same things the
 * `ga_health_check` tool says, because most users never call the tool.
 *
 * The prerequisite table is deliberately small and honest about what can be
 * probed: only a PATH lookup is verified; the rest are reported as "unknown"
 * so the panel can show them as information rather than as errors.
 */
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** External requirements a curated plugin cannot ship inside an npm package. */
export const EXTERNAL_REQUIREMENTS = [
	{
		match: /dsh-browser-use/u,
		needs: '需要 `uv` CLI（首次使用會自動建立 Python venv，約 25MB）',
		needsEn: 'needs the `uv` CLI (a ~25MB Python venv is created on first use)',
		probe: 'uv',
		fix: 'brew install uv',
		fixEn: 'brew install uv',
	},
	{
		match: /modlens/u,
		needs: '需要 Antigravity CLI 作為視覺後端（未安裝則視覺功能不可用）',
		needsEn: 'needs the Antigravity CLI as its vision backend (no vision without it)',
		probe: null,
		fix: '依 modlens README 安裝 Antigravity CLI',
		fixEn: 'install the Antigravity CLI per the modlens README',
	},
	{
		match: /dsh-im/u,
		needs: '需要 IM 應用憑證（飛書／微信／Slack…），否則只有背景日誌',
		needsEn: 'needs an IM application credential (Feishu / WeChat / Slack …), otherwise it only logs',
		probe: null,
		fix: '在 設定 → IM bots 填入憑證',
		fixEn: 'fill in the credential under Settings → IM bots',
	},
	{
		match: /dsh-mobile/u,
		needs: '需要一個空閒 TCP 埠（預設 3443），同機第二個 gateway 會相撞',
		needsEn: 'needs a free TCP port (3443 by default); a second gateway on the same machine collides',
		probe: null,
		fix: '關閉佔用 3443 的其他程式，或改 dsh-mobile 的埠號',
		fixEn: 'free port 3443 or change dsh-mobile\'s port',
	},
]

/** True when `name` is an executable on PATH. */
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

/** Curated plugins this profile also installs directly (two rows, two activations). */
export function duplicatePlugins(curated, profile) {
	if (profile === undefined) return []
	const direct = new Set([...profile.dependencies, ...profile.bundles])
	return curated.filter(name => direct.has(name))
}

/**
 * Structured prerequisites for the panel.
 * @returns {{plugin: string, needs: string, probe: string|null, state: 'found'|'missing'|'unknown', fix: string}[]}
 */
export function prerequisiteItems(curated, probe = probeCommand) {
	const items = []
	for (const plugin of curated) {
		for (const requirement of EXTERNAL_REQUIREMENTS) {
			if (!requirement.match.test(plugin)) continue
			const state = requirement.probe === null
				? 'unknown'
				: probe(requirement.probe) ? 'found' : 'missing'
			items.push({
				plugin,
				needs: requirement.needs,
				needsEn: requirement.needsEn,
				probe: requirement.probe,
				state,
				fix: requirement.fix,
				fixEn: requirement.fixEn,
			})
		}
	}
	return items
}

/** The human-readable lines the MCP tool reports. */
export function prerequisiteReport(curated, probe = probeCommand) {
	return prerequisiteItems(curated, probe).map(item => {
		const state = item.state === 'found' ? 'found on PATH'
			: item.state === 'missing' ? `MISSING (${item.probe})`
				: 'not probed'
		return `${item.plugin}: ${item.needs} [${state}]`
	})
}
