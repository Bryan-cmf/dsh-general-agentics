/**
 * The curated marketplace catalog — dsh-general-agentics.
 *
 * Since 0.3.0 the bundle no longer carries third-party plugins as package.json
 * dependencies. It ships the front-end design, the first-party plugins
 * (dsh-comments, dsh-promptimizer) and this catalog: a recommended list the
 * panel renders with one-click install and one-click update buttons.
 *
 * Why not dependencies (the pre-0.3.0 design): a bundle dependency is a floor
 * we must raise and republish for every upstream release, a major bump
 * upstream is a decision we must make for every user, and installing around
 * the bundle is what the health card flags as a duplicate. A direct install
 * is the user's own row, updated on the user's own click — nothing to
 * reconcile, nothing to drift. The bundle's overlay used to carry each
 * plugin's patch rows verbatim for the same reason; as direct installs their
 * own patch layers activate, so those copies are gone too.
 *
 * Entry shape:
 *   name     registry package name
 *   category grouping shown in the panel
 *   blurb    { zh, en } one line on what it does and why it is here
 *   prereq   optional external requirement (see lib/health.mjs EXTERNAL_REQUIREMENTS)
 *   pinned   optional note when a version decision is deliberate
 */

/** @type {ReadonlyArray<{name: string, category: string, blurb: {zh: string, en: string}, prereq?: string, pinned?: string}>} */
export const CATALOG = [
	{
		name: '@xmanrui/dsh-im',
		category: 'communication',
		blurb: {
			zh: 'IM 通知與訊息橋接（釘釘／飛書等）；建議保持在最新版，舊版已知會報錯。',
			en: 'IM notifications and message bridging; keep current — older releases are known to misbehave.',
		},
	},
	{
		name: 'dshmarket',
		category: 'discovery',
		blurb: {
			zh: '插件市場：瀏覽、搜尋與安裝整個生態系（本型錄的靈感來源）。',
			en: 'The plugin marketplace: browse, search and install the wider ecosystem (the inspiration for this catalog).',
		},
	},
	{
		name: 'dsh-cost-meter',
		category: 'observation',
		blurb: {
			zh: '花費與用量儀表（峰值條、餘額行）；本 bundle 的 transcript 預設會顯示每則回覆的用量。',
			en: 'Cost and usage metering (peak strip, balance row); this bundle\u2019s transcript defaults surface the per-reply usage line.',
		},
	},
	{
		name: 'dsh-context',
		category: 'observation',
		blurb: {
			zh: '上下文與任務面板（本 bundle 的預設開啟 fleet 分頁）。',
			en: 'Context and task panel (this bundle\u2019s defaults enable the fleet tab).',
		},
	},
	{
		name: '@changfenhuang/dsh-genui',
		category: 'interface',
		blurb: {
			zh: '把結構化輸出渲染成卡片（表格、表單、圖表）。',
			en: 'Renders structured output as cards (tables, forms, charts).',
		},
	},
	{
		name: 'dsh-better-sidebar',
		category: 'interface',
		blurb: {
			zh: '增強側欄：工具按鈕與自訂分頁（本 bundle 的預設開啟 agent 工具與 sentinel 分頁）。',
			en: 'Enhanced sidebar: tool buttons and custom tabs (this bundle\u2019s defaults enable the agent tools and sentinel tab).',
		},
	},
	{
		name: '@liustack/modlens',
		category: 'interface',
		blurb: {
			zh: '訊息透鏡：濃縮、對照與審視長回覆。',
			en: 'Message lens: condense, compare and inspect long replies.',
		},
	},
	{
		name: '@liustack/modsearch',
		category: 'discovery',
		blurb: {
			zh: '網頁搜尋聚合（直裝後由它自己的 patch 接管搜尋提供者）。',
			en: 'Web search aggregation (once installed, its own patch takes over the search provider).',
		},
	},
	{
		name: 'dsh-sentinel',
		category: 'automation',
		blurb: {
			zh: '哨兵：條件觸發的守望（檔案、埠、行程、webhook），事件發生時喚醒代理。',
			en: 'Sentinel: condition watches (file, port, process, webhook) that wake the agent when things change.',
		},
	},
	{
		name: '@ricardochen1996/dsh-browser-use',
		category: 'automation',
		blurb: {
			zh: '瀏覽器自動化（需要 uv；首次使用會建約 25MB 的 Python venv）。',
			en: 'Browser automation (needs uv; provisions a ~25MB Python venv on first use).',
		},
		prereq: 'uv',
	},
	{
		name: 'dsh-mobile',
		category: 'communication',
		blurb: {
			zh: '手機存取：LAN／隧道連回這台機器（安裝後它自己會接手 directory-picker 與閘道設定）。',
			en: 'Mobile access: reach this machine over LAN or a tunnel (its own patch wires the gateway and directory picker).',
		},
	},
]

/** Catalog names as a Set, for quick membership checks. */
export const CATALOG_NAMES = new Set(CATALOG.map(entry => entry.name))

/**
 * The catalog entry for a package, or undefined.
 * @param {string} name
 */
export function catalogEntry(name) {
	return CATALOG.find(entry => entry.name === name)
}
