/**
 * A tiny browser + React harness for the client half.
 *
 * `lib/client.js` registers a factory with `window.__ModuleLoader__`; the factory
 * returns `apply(ctx)`, which registers components into slots. Nothing here
 * renders through the real shell, so this harness supplies the small surface the
 * client code touches (document, window, localStorage, fetch) and a hooks
 * runtime that renders component trees to plain objects.
 *
 * It is deliberately minimal: every helper exists because the client half uses
 * it, not to imitate a browser.
 */
import { readFileSync } from 'node:fs'

/** Element-ish node that records what a component does to it. */
function createNode(tagName) {
	const node = {
		tagName: String(tagName).toUpperCase(),
		children: [],
		style: {},
		props: {},
		listeners: [],
		attributes: {},
		textContent: '',
		className: '',
		value: '',
		focused: false,
		appendChild(child) { this.children.push(child); return child },
		append(...list) { this.children.push(...list) },
		removeChild(child) { this.children = this.children.filter(item => item !== child); return child },
		remove() { this.removed = true },
		setAttribute(name, value) { this.attributes[name] = String(value) },
		getAttribute(name) { return this.attributes[name] ?? null },
		addEventListener(type, handler) { this.listeners.push({ type, handler }) },
		removeEventListener(type, handler) { this.listeners = this.listeners.filter(item => item.type !== type || item.handler !== handler) },
		dispatchEvent(event) { for (const item of this.listeners) if (item.type === event.type) item.handler(event); return true },
		focus() { this.focused = true },
		select() { this.selected = true },
		getBoundingClientRect() { return { x: 0, y: 0, width: 400, height: 20, top: 0, left: 0, right: 400, bottom: 20 } },
		insertBefore(child) { this.children.push(child); return child },
		click() { const handler = this.props?.onClick; if (typeof handler === 'function') handler() },
		querySelector() { return null },
		querySelectorAll() { return [] },
	}
	return node
}

/** Build the document/window pair the client half expects. */
export function createBrowser({ language = 'en-US', composer = true } = {}) {
	const store = new Map()
	const listeners = []
	const posted = []
	const reloads = []

	const body = createNode('body')
	const head = createNode('head')
	const documentElement = createNode('html')
	documentElement.style = {}

	const composerNode = composer ? createNode('textarea') : null
	if (composerNode !== null) {
		composerNode.value = ''
		composerNode.execCommand = (command, _show, text) => {
			composerNode.value = text
			composerNode.execCommandCalls = (composerNode.execCommandCalls ?? 0) + 1
			return true
		}
	}

	const document = {
		body,
		head,
		documentElement,
		title: '',
		createElement: tag => createNode(tag),
		createTextNode: text => ({ nodeType: 3, textContent: String(text), children: [] }),
		createTreeWalker: () => ({ nextNode: () => null }),
		querySelector(selector) {
			if (composerNode !== null && selector.includes('Describe')) return composerNode
			if (selector.includes('contenteditable')) return composerNode
			if (composerNode !== null && selector === 'textarea[placeholder^="Describe"]') return composerNode
			return null
		},
		querySelectorAll: () => [],
		execCommand: (command, _show, text) => {
			if (composerNode !== null && command === 'insertText') {
				composerNode.value = text
				return true
			}
			return false
		},
		getElementById: () => null,
		dispatchEvent: event => true,
		addEventListener: () => {},
		removeEventListener: () => {},
		documentElement: documentElement,
		readyState: 'complete',
	}

	const window = {
		document,
		navigator: { language, clipboard: { writeText: async text => { window.clipboardText = text } } },
		localStorage: {
			getItem: key => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => { store.set(key, String(value)) },
			removeItem: key => { store.delete(key) },
		},
		setTimeout: (fn, ms) => setTimeout(fn, 0),
		clearTimeout: id => clearTimeout(id),
		setInterval: () => 0,
		clearInterval: () => {},
		requestAnimationFrame: fn => { setTimeout(() => fn(0), 0); return 0 },
		cancelAnimationFrame: () => {},
		addEventListener: (type, handler) => listeners.push({ type, handler }),
		removeEventListener: (type, handler) => {
			const index = listeners.findIndex(item => item.type === type && item.handler === handler)
			if (index >= 0) listeners.splice(index, 1)
		},
		dispatchEvent: event => {
			for (const item of listeners.filter(entry => entry.type === event.type)) item.handler(event)
			return true
		},
		location: { reload: () => reloads.push(Date.now()), href: 'http://localhost/' },
		getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }),
		Event: class Event { constructor(type) { this.type = type } },
		CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } },
		document,
	}

	const fetch = async (url, options = {}) => {
		posted.push({ url: String(url), options })
		const handler = fetch.handler
		if (typeof handler === 'function') return handler(String(url), options)
		return { ok: true, status: 200, json: async () => ({}) }
	}
	window.fetch = fetch
	window.globalThis = window

	return { window, document, fetch, store, posted, listeners, reloads, composer: composerNode }
}

/** A React-shaped API with just enough hooks to render a component tree. */
export function createReact() {
	const depsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

	const React = {
		createElement(type, props, ...children) {
			return { type, props: props ?? {}, children: children.flat(Infinity) }
		},
		useState(initial) {
			const runtime = current()
			const index = runtime.index++
			if (runtime.hooks[index] === undefined) runtime.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
			const cell = runtime.hooks[index]
			return [cell.value, next => {
				cell.value = typeof next === 'function' ? next(cell.value) : next
				runtime.dirty = true
			}]
		},
		useEffect(fn, deps) {
			const runtime = current()
			const index = runtime.index++
			const previous = runtime.hooks[index]
			if (previous === undefined || !depsEqual(previous.deps, deps)) runtime.effects.push(fn)
			runtime.hooks[index] = { deps }
		},
		useCallback: fn => fn,
		useMemo: fn => fn(),
		useRef: value => ({ current: value }),
	}

	let active = null
	const current = () => {
		if (active === null) throw new Error('hooks called outside render')
		return active
	}

	/** Mount a component and keep its hook cells across re-renders. */
	const mount = (Component, props = {}) => {
		const runtime = { hooks: [], index: 0, effects: [], dirty: false, cleanups: [] }
		const pass = () => {
			active = runtime
			runtime.index = 0
			runtime.effects = []
			runtime.dirty = false
			const tree = Component(props)
			for (const effect of runtime.effects) {
				const cleanup = effect()
				if (typeof cleanup === 'function') runtime.cleanups.push(cleanup)
			}
			active = null
			return tree
		}
		const view = {
			tree: pass(),
			// A setter may fire during effects; settle before returning.
			render() {
				for (let i = 0; i < 25 && (view.tree === undefined || runtime.dirty || i === 0); i++) view.tree = pass()
				return view.tree
			},
			text() { return textOf(view.tree) },
			unmount() { for (const cleanup of runtime.cleanups) cleanup() },
		}
		return view
	}

	/** Let promise chains started by effects run, then re-render. */
	const settle = async (view, rounds = 8) => {
		for (let i = 0; i < rounds; i++) await Promise.resolve()
		view.render()
		return view
	}

	return { React, mount, settle }
}

/** Collect every string rendered in a tree. */
export function textOf(node) {
	if (node === null || node === undefined || typeof node === 'boolean') return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join(' ')
	if (typeof node === 'object' && node.children !== undefined) {
		const props = node.props ?? {}
		const own = typeof props.text === 'string' ? props.text : ''
		return `${own} ${textOf(node.children)}`.trim()
	}
	return ''
}

/** Depth-first search for a rendered href/onClick button by its visible text. */
export function findButton(node, label) {
	const out = []
	const walk = current => {
		if (current === null || current === undefined || typeof current !== 'object') return
		if (Array.isArray(current)) { current.forEach(walk); return }
		const props = current.props ?? {}
		const text = textOf(current).trim()
		if (typeof current.type === 'function') {
			walk(current.type(props, current.children))
			return
		}
		if (props.onClick !== undefined && text.includes(label)) out.push(current)
		walk(current.children)
	}
	walk(node)
	return out[0]
}

/** First input whose aria-label or placeholder matches. */
export function findInput(node, label) {
	const out = []
	const walk = current => {
		if (current === null || current === undefined || typeof current !== 'object') return
		if (Array.isArray(current)) { current.forEach(walk); return }
		const props = current.props ?? {}
		if (current.type === 'input' && (props['aria-label'] === label || String(props.placeholder ?? '').includes(label))) out.push(current)
		walk(current.children)
	}
	walk(node)
	return out[0]
}

export function findLink(node, prefix) {
	const out = []
	const walk = current => {
		if (current === null || current === undefined || typeof current !== 'object') return
		if (Array.isArray(current)) { current.forEach(walk); return }
		const props = current.props ?? {}
		if (typeof current.type === 'function') { walk(current.type(props, current.children)); return }
		if (typeof props.href === 'string' && props.href.startsWith(prefix)) out.push(current)
		walk(current.children)
	}
	walk(node)
	return out[0]
}

/**
 * Load lib/client.js, materialise its factory, call `apply` and return the
 * components it registered into slots.
 */
export function loadClient({ browser, react }) {
	const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
	let definition
	const sandboxWindow = { ...browser.window, __ModuleLoader__: { load: value => { definition = value } } }
	const require = name => {
		if (name === 'react') return react.React
		throw new Error(`unexpected require(${name})`)
	}
	const runner = new Function('window', 'document', 'navigator', 'localStorage', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'Event', 'CustomEvent', 'Node', 'NodeFilter', 'MutationObserver', 'getComputedStyle', 'performance', 'Buffer', 'URL', 'console', source)
	runner(
		sandboxWindow,
		browser.document,
		sandboxWindow.navigator,
		sandboxWindow.localStorage,
		browser.fetch,
		sandboxWindow.setTimeout,
		sandboxWindow.setInterval,
		sandboxWindow.requestAnimationFrame,
		sandboxWindow.Event,
		sandboxWindow.CustomEvent,
		globalThis.Node ?? class Node {},
		globalThis.NodeFilter ?? { SHOW_TEXT: 4 },
		class MutationObserver { observe() {} disconnect() {} takeRecords() { return [] } },
		() => ({ borderRadius: '8px', width: '400px' }),
		performance,
		Buffer,
		URL,
		console,
	)
	if (definition === undefined) throw new Error('client module did not register a factory')

	const registered = []
	const effects = []
	const themeCalls = []
	const ctx = {
		slots: {
			inject: (_name, callback) => callback(),
			register: (options, Component) => { registered.push({ options, Component }); return () => {} },
		},
		theme: { overrideTokens: (source, tokens) => { themeCalls.push({ source, tokens }); return () => {} } },
		effect: (fn, label) => { const cleanup = fn(); effects.push({ label, cleanup }); return cleanup },
		get: name => (name === 'locale' ? { getSnapshot: () => ({ active: 'en-US' }) } : undefined),
	}
	const exports = definition.factory(require)
	exports.apply(ctx)

	const find = name => registered.find(item => item.options.name === name)?.Component
	return { exports, registered, effects, themeCalls, panel: find('settings.section'), badge: find('sidebar.toggle.badge'), pluginBadge: find('plugins.detail.badge'), }
}
