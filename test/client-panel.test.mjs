import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowser, createReact, loadClient, textOf, findButton, findInput } from './helpers/client-harness.mjs'

const STATUS = (overrides = {}) => ({
	current: '0.2.0-alpha.25',
	latest: '0.2.0-alpha.25',
	updateAvailable: false,
	localAhead: false,
	profile: { name: 'tester', dir: '~/.dsh/profiles/tester', source: 'argv-profile', frozenInstall: true },
	updateCommand: 'dsh plugin --profile tester add dsh-general-agentics@latest',
	skills: ['brainstorming', 'writing-plans'],
	skillDetails: [
		{ name: 'brainstorming', description: 'You MUST use this before any creative work.' },
		{ name: 'writing-plans', description: 'Use when you have a spec for a multi-step task.' },
	],
	curated: [
		{ name: 'dsh-context', spec: '^0.73.0', installed: '0.73.0', latest: '0.73.0', updateAvailable: false },
		{ name: 'dsh-cost-meter', spec: '^1.8.36', installed: '1.9.3', latest: '1.9.3', updateAvailable: false },
	],
	prerequisites: [{ plugin: 'dsh-browser-use', needs: 'needs uv', state: 'found' }],
	settings: { quietHours: null, quietNow: false, accent: 'indigo' },
	health: { score: 94, grade: 'A', deductions: [{ code: 'behind', points: 6, detail: '3 behind the registry' }] },
	csrf: 'csrf-token',
	rollback: undefined,
	...overrides,
})

/** Boot the client half with a fetch that answers like the host would. */
function setup({ language = 'en-US', status = STATUS(), fetchOverride } = {}) {
	const browser = createBrowser({ language })
	const { React, mount, settle } = createReact()
	// the starter strip wants a parent chain to insert itself into
	const outer = browser.document.createElement('div')
	const main = browser.document.createElement('div')
	outer.appendChild(main)
	main.parentElement = outer
	outer.parentElement = null
	if (browser.composer !== null) {
		main.appendChild(browser.composer)
		browser.composer.parentElement = main
	}
	browser.fetch.handler = async (url, options = {}) => {
		if (typeof fetchOverride === 'function') {
			const answer = fetchOverride(url, options)
			if (answer !== undefined) return answer
		}
		if (url.includes('?diagnostics=1')) return { ok: true, status: 200, json: async () => ({ ok: true, markdown: '# diag\nprofile: ~/.dsh/profiles/tester' }) }
		if (url.includes('?usage=1')) {
			return {
				ok: true, status: 200,
				json: async () => ({ ok: true, sessions: 3, toolCalls: 12, tools: [{ name: 'bash', count: 12 }], skills: [{ name: 'brainstorming', count: 2 }], scope: 'all-workspaces' }),
			}
		}
		if (options.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) }
		return { ok: true, status: 200, json: async () => status }
	}
	const client = loadClient({ browser, react: { React } })
	return { browser, client, mount, settle }
}

test('the client half registers the brand slots, the badges and the panel', () => {
	const { client } = setup()
	const names = client.registered.map(item => item.options.name)
	assert.deepEqual(names.sort(), [
		'conversation.hero.brand.mark',
		'plugins.detail.badge',
		'settings.section',
		'sidebar.brand.mark',
		'sidebar.brand.name',
		'sidebar.footer.action',
		'sidebar.toggle.badge',
	])
	assert.equal(client.exports.name, 'general-agentics')
	assert.deepEqual(client.exports.inject, ['slots', 'theme'])
	assert.equal(client.panel !== undefined, true)
	assert.equal(client.badge !== undefined, true)
	assert.equal(client.pluginBadge !== undefined, true)
})

test('the panel opens on Status and shows the health summary', async () => {
	const { client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const text = view.text()
	for (const expected of ['General Agentics', '0.2.0-alpha.25', 'Health & usage', '94 / 100', 'Three quick preferences']) {
		assert.ok(text.includes(expected), `status tab is missing "${expected}"\n${text.slice(0, 400)}`)
	}
	// the plugin list lives on its own tab now
	assert.ok(!text.includes('Curated plugins'), 'the plugin list should not be on the status tab')
})

test('the four tabs show their own content', async () => {
	const { client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const open = async label => {
		const button = findButton(view.tree, label)
		assert.ok(button !== undefined, `no ${label} tab`)
		button.props.onClick()
		view.render()
		return view.text()
	}
	assert.ok((await open('Plugins')).includes('Curated plugins'))
	assert.ok((await open('Skills')).includes('Bundled skills'))
	assert.ok((await open('Settings')).includes('Brand appearance'))
	assert.ok((await open('Settings')).includes('Reminders'))
})

test('switching language is live and does not reload the page', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const zh = findButton(view.tree, '中文')
	assert.ok(zh !== undefined, 'no language control')
	zh.props.onClick()
	view.render()
	assert.ok(view.text().includes('健康與使用') || view.text().includes('狀態'), 'panel did not re-render in Chinese')
	assert.equal(browser.reloads.length, 0, 'switching language must not reload')
	assert.equal(browser.store.get('general-agentics/lang'), 'zh')
})

test('Esc clears the skills search', async () => {
	const { client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const skillsTab = findButton(view.tree, 'Skills')
	skillsTab.props.onClick()
	view.render()
	const input = findInput(view.tree, 'Search skills')
	assert.ok(input !== undefined, 'no skills search input')
	input.props.onChange({ target: { value: 'brain' } })
	view.render()
	assert.ok(view.text().includes('brainstorming'))
	input.props.onKeyDown({ key: 'Escape' })
	view.render()
	assert.ok(!JSON.stringify(view.tree).includes('"brain"'), 'Escape did not clear the query')
})

test('Try seeds the composer with the skill prompt', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	findButton(view.tree, 'Skills').props.onClick()
	view.render()
	const tryButton = findButton(view.tree, 'Try')
	assert.ok(tryButton !== undefined, 'no Try button rendered')
	tryButton.props.onClick()
	assert.equal(browser.composer.value, 'Use the "brainstorming" skill for this task: ')
})

test('choosing an accent posts the setting with the panel token', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const teal = findButton(view.tree, 'Teal')
	assert.ok(teal !== undefined, 'no Teal control')
	teal.props.onClick()
	await settle(view)
	const write = browser.posted.find(entry => entry.url.includes('action=settings') && entry.url.includes('accent=teal'))
	assert.ok(write !== undefined, `no accent write; posted: ${browser.posted.map(p => p.url).join(', ')}`)
	assert.equal(write.options.headers['x-ga-csrf'], 'csrf-token')
})

test('quiet hours are written through the same endpoint', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const quiet = findButton(view.tree, '22:00–08:00')
	assert.ok(quiet !== undefined, 'no quiet-hours control')
	quiet.props.onClick()
	await settle(view)
	assert.ok(browser.posted.some(entry => entry.url.includes('quiet=night')), 'quiet window was not written')
})

test('the first-run card dismisses and stays dismissed', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	assert.ok(view.text().includes('Three quick preferences'))
	const done = findButton(view.tree, 'Done')
	done.props.onClick()
	assert.equal(browser.store.get('ga/wizard-done'), '1')
	await settle(view)
	assert.ok(!view.text().includes('Three quick preferences'), 'the card came back')
})

test('copy diagnostics fetches the report and puts it on the clipboard', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const copy = findButton(view.tree, 'Copy diagnostics')
	copy.props.onClick()
	await settle(view)
	assert.ok(browser.posted.some(entry => entry.url.includes('diagnostics=1')), 'diagnostics endpoint was not called')
	const call = browser.posted.find(entry => entry.url.includes('diagnostics=1'))
	assert.equal(call.options.method, 'POST', 'diagnostics must be a POST now')
	assert.equal(call.options.headers?.['x-ga-csrf'], 'csrf-token', 'the panel token must travel with it')
	assert.ok(String(browser.window.clipboardText ?? '').includes('# diag'), `clipboard: ${browser.window.clipboardText}`)
})

test('the sidebar dot appears for an update and hides during quiet hours', async () => {
	const withUpdate = setup({ status: STATUS({ updateAvailable: true, latest: '0.2.0-alpha.30' }) })
	const view = withUpdate.mount(withUpdate.client.badge, { hidden: false })
	await withUpdate.settle(view)
	assert.ok(view.text().includes('Update available') || JSON.stringify(view.tree).includes('"data-ga-badge":"update"'), 'no update dot')
	const quiet = setup({ status: STATUS({ updateAvailable: true, latest: '0.2.0-alpha.30', settings: { quietHours: { from: 22, to: 8 }, quietNow: true, accent: 'indigo' } }) })
	const quietView = quiet.mount(quiet.client.badge, { hidden: false })
	await quiet.settle(quietView)
	assert.equal(quietView.tree, null, 'the dot must be hidden during the quiet window')
})

test('the plugin badge marks curated plugins and ignores everything else', async () => {
	const curated = setup()
	const view = curated.mount(curated.client.pluginBadge, { subject: { name: 'dsh-context' } })
	await curated.settle(view)
	assert.ok(view.text().includes('GA curated'), `badge text: ${view.text()}`)
	const other = setup()
	const otherView = other.mount(other.client.pluginBadge, { subject: { name: 'something-else' } })
	await other.settle(otherView)
	assert.equal(otherView.tree, null)
})

test('the sidebar footer shows a status pill only when something is wrong', async () => {
	const withUpdate = setup({ status: STATUS({ updateAvailable: true, latest: '0.2.0-alpha.30' }) })
	const view = withUpdate.mount(withUpdate.client.footer, { wide: true })
	await withUpdate.settle(view)
	assert.ok(view.tree !== null, 'no footer pill for a pending update')
	assert.ok(view.text().includes('Update available'), `pill text: ${view.text()}`)
	// hidden is honoured (the shell can ask the footer to stand down)
	const hidden = setup({ status: STATUS({ updateAvailable: true }) })
	const hiddenView = hidden.mount(hidden.client.footer, { wide: true, hidden: true })
	await hidden.settle(hiddenView)
	assert.equal(hiddenView.tree, null)
	const clean = setup()
	const cleanView = clean.mount(clean.client.footer, { wide: true })
	await clean.settle(cleanView)
	assert.equal(cleanView.tree, null, 'a clean deployment must not nag')
})

test('attention is reflected in the tab title', async () => {
	const { browser, client, mount, settle } = setup({ status: STATUS({ updateAvailable: true, latest: '0.2.0-alpha.30' }) })
	browser.document.title = 'DeepSeek Harness'
	const view = mount(client.badge, { hidden: false })
	await settle(view)
	assert.ok(String(browser.document.title).startsWith('● '), `title: ${browser.document.title}`)
	assert.ok(String(browser.document.title).includes('General Agentics'))
})

test('the tab list can be driven with the arrow keys', async () => {
	const { client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const tablist = view.tree.children.find(child => child !== null && child.props?.role === 'tablist')
	assert.ok(tablist !== undefined, 'no tablist')
	tablist.props.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} })
	view.render()
	const selected = view.tree.children.find(child => child !== null && child.props?.role === 'tablist')
		.children.filter(child => child.props?.role === 'tab')
		.find(child => child.props['aria-selected'] === true)
	assert.ok(textOf(selected).includes('Plugins'), `selected tab: ${textOf(selected)}`)
})

test('controls expose hover and focus states', async () => {
	const { client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const tab = view.tree.children.find(child => child !== null && child.props?.role === 'tablist')
		.children.filter(child => child.props?.role === 'tab')[0]
	assert.equal(typeof tab.props.onMouseEnter, 'function', 'no hover handler')
	assert.equal(typeof tab.props.onFocus, 'function', 'no focus handler')
	const style = {}
	tab.props.onFocus({ currentTarget: { style } })
	assert.ok(String(style.outline ?? '').includes('2px'), `focus outline: ${style.outline}`)
})

test('the hero brand carries a stable hook and stacks the attribution', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.heroMark, { className: 'fish' })
	await settle(view)
	assert.equal(view.tree.props['data-ga-hero'], 'wordmark')
	const style = browser.document.head.children.find(node => node.tagName === 'STYLE' && node.attributes['data-ga-hero-layout'] !== undefined)
	assert.ok(style !== undefined, 'hero layout style was not injected')
	assert.ok(style.textContent.includes('flex-direction: column'), 'the row is not stacked')
	assert.ok(style.textContent.includes('font-size: 12.5px'), 'the attribution is not smaller')
	assert.ok(style.textContent.includes(':has(> span [data-ga-hero="wordmark"])'), 'the selector lost its anchor')
})

test('the plugin badge registers into the list slot with an id', () => {
	const { client } = setup()
	const entry = client.registered.find(item => item.options.name === 'plugins.detail.badge')
	assert.ok(entry !== undefined, 'no plugins.detail.badge registration')
	assert.equal(entry.options.id, 'general-agentics')
	assert.equal(entry.options.priority, undefined, 'list slots do not take priority')
})

test('the composer compacts to one row on phone widths', async () => {
	const { browser, client } = setup()
	const style = browser.document.head.children.find(node => node.tagName === 'STYLE' && node.attributes['data-ga-composer-compact'] !== undefined)
	assert.ok(style !== undefined, 'composer compact style was not injected')
	assert.ok(style.textContent.includes('max-width: 460px'), 'no phone breakpoint')
	assert.ok(style.textContent.includes('#pmz-strength { display: none !important; }'), 'the caret is not hidden (inline display needs !important)')
	assert.ok(style.textContent.includes(':has(> div > div > div > #pmz-opt)'), 'the row is not anchored to the optimize button')
	assert.ok(style.textContent.includes('.aag-btn { font-size: 0 !important;'), 'the Experts label is not collapsed with priority')
})


test('an out-of-range plugin shows the floor hint, never a direct-install button', async () => {
	const status = STATUS({
		curated: [
			{ name: 'dsh-context', spec: '^0.73.0', installed: '0.73.0', latest: '0.73.0', updateAvailable: false },
			{ name: '@xmanrui/dsh-im', spec: '^4.39.0', installed: '4.39.0', latest: '5.2.0', updateAvailable: false, outOfRange: true },
		],
	})
	const { client, mount, settle } = setup({ status })
	const view = mount(client.panel)
	await settle(view)
	findButton(view.tree, 'Plugins').props.onClick()
	view.render()
	const text = view.text()
	assert.ok(text.includes('Newer 5.2.0 (out of range)'), 'the out-of-range badge is missing')
	findButton(view.tree, '@xmanrui/dsh-im').props.onClick()
	view.render()
	const floor = findButton(view.tree, 'Copy floor bump')
	assert.ok(floor !== undefined, 'no floor-bump button')
	assert.ok(view.text().includes('outside the ^4.39.0'), 'the range hint is missing')
	assert.ok(!view.text().includes('Copy install command'), 'a curated row must not offer a direct install')
})

test('the layout canaries are exposed for console diagnosis', async () => {
	const { browser, client, mount, settle } = setup()
	const view = mount(client.panel)
	await settle(view)
	const diag = client.diag
	assert.ok(diag !== null, 'no __DSH_GA_DIAG__ handle')
	assert.equal(typeof diag.heroMatches, 'number', 'no heroMatches canary')
	assert.equal(typeof diag.compactMatches, 'number', 'no compactMatches canary')
})


test('the marketplace lists catalog entries with one-click install', async () => {
	const status = STATUS({
		curated: [
			{ name: 'dsh-comments', spec: '^0.6.1', installed: '0.6.1', latest: '0.6.1', updateAvailable: false, included: true },
			{ name: '@xmanrui/dsh-im', included: false, installed: undefined, latest: '5.2.0', updateAvailable: false, category: 'communication', blurb: { zh: 'IM 通知', en: 'IM notifications' }, residual: '4.39.0' },
			{ name: 'dshmarket', included: false, installed: '1.66.35', latest: '1.66.44', updateAvailable: true, category: 'discovery', blurb: { zh: '插件市場', en: 'The plugin marketplace' } },
		],
	})
	const { browser, client, mount, settle } = setup({ status })
	const view = mount(client.panel)
	await settle(view)
	findButton(view.tree, 'Plugins').props.onClick()
	view.render()
	const text = view.text()
	// two worlds, one list
	assert.ok(text.includes('Included with this bundle (1)'), 'included section missing')
	assert.ok(text.includes('Curated marketplace'), 'marketplace section missing')
	assert.ok(text.includes('Not installed'), 'not-installed badge missing')
	assert.ok(text.includes('leftover files 4.39.0'), 'residual note missing')
	// one click posts the token
	const install = findButton(view.tree, 'Install')
	assert.ok(install !== undefined, 'no install button')
	install.props.onClick()
	await settle(view)
	const call = browser.posted.find(entry => entry.url.includes('action=plugin'))
	assert.ok(call !== undefined, 'install never posted')
	assert.equal(call.options.method, 'POST')
	assert.equal(call.options.headers?.['x-ga-csrf'], 'csrf-token')
	assert.ok(call.url.includes(encodeURIComponent('@xmanrui/dsh-im')))
	// an up-to-date direct install offers no button at all… and an outdated one offers Update
	assert.ok(findButton(view.tree, 'Update') !== undefined, 'no update button for the outdated direct install')
})


test('install-all walks the catalog sequentially with progress', async () => {
	const status = STATUS({
		curated: [
			{ name: 'dsh-comments', spec: '^0.6.1', installed: '0.6.1', latest: '0.6.1', updateAvailable: false, included: true },
			{ name: 'dshmarket', included: false, installed: undefined, latest: '1.66.44', updateAvailable: false, category: 'discovery', blurb: { zh: '市場', en: 'market' } },
			{ name: 'dsh-sentinel', included: false, installed: undefined, latest: '0.11.1', updateAvailable: false, category: 'automation', blurb: { zh: '哨兵', en: 'sentinel' } },
			{ name: 'dsh-context', included: false, installed: '0.73.0', latest: '0.73.3', updateAvailable: true, category: 'observation', blurb: { zh: '上下文', en: 'context' } },
		],
	})
	const { browser, client, mount, settle } = setup({ status })
	const view = mount(client.panel)
	await settle(view)
	findButton(view.tree, 'Plugins').props.onClick()
	view.render()
	// two not-installed → one button; the outdated direct install gets its own
	const all = findButton(view.tree, 'Install all (2)')
	assert.ok(all !== undefined, 'no install-all button')
	assert.ok(findButton(view.tree, 'Update all (1)') !== undefined, 'no update-all button')
	all.props.onClick()
	await settle(view)
	const pluginPosts = browser.posted.filter(entry => entry.url.includes('action=plugin'))
	assert.equal(pluginPosts.length, 2, `expected 2 sequential installs, got ${pluginPosts.length}`)
	assert.ok(pluginPosts.every(entry => entry.options.method === 'POST' && entry.options.headers?.['x-ga-csrf'] === 'csrf-token'))
	assert.ok(view.text().includes('batch done'), 'no batch summary')
})
