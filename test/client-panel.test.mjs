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
