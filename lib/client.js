/**
 * dsh-general-agentics — browser half.
 *
 * Hand-authored bundle in the lazy-CJS shape the shell's module loader expects
 * (contract: packages/client/modules/src/client/manifest.ts:258-268 — the
 * registration `id` must equal this package's name). Executing this file only
 * REGISTERS a factory; every side effect happens inside the factory closure at
 * materialization (i.e. inside `apply`).
 *
 * What it contributes:
 *   1. Brand occupants for the three generic brand slots —
 *      `sidebar.brand.mark` (owner {size}), `sidebar.brand.name` (owner {}),
 *      `conversation.hero.brand.mark` (owner {size, className}) — registered
 *      at priority -1. Slot rule (packages/client/ui-slots/src/index.ts:
 *      717-722): in a `single` cell the LOWEST live priority renders; equal
 *      priority would throw. The official occupants register at the default
 *      0, so -1 shadows them without disabling `ui-brand-official`.
 *   2. A theme token override layer (`ctx.theme.overrideTokens`). Both light
 *      and dark values are mandatory by contract (ThemeTokenModes) — a bare
 *      string throws.
 *   3. Runtime rebrand of the browser tab: document.title suffix rewrite
 *      (resilient against the shell's DocumentTitle effect — the only other
 *      writer in the client tree), favicon link swap with full restore, and a
 *      best-effort PWA manifest swap. These surfaces are baked into the
 *      shipped frontend dist (DSH_CLIENT_TITLE is a build-time define), so a
 *      runtime rewrite is the only bundle-level way to reach them.
 *
 * Side-effect discipline: everything runs inside `ctx.effect(fn, label)` (same
 * as dsh-pomodoro), so fiber unload / plugin disable reclaims it.
 *
 * Requires services: `slots`, `theme`.
 */

window.__ModuleLoader__.load({
	id: 'dsh-general-agentics',
	factory: (require) => {
		const React = require('react') // platform seed word (web/src/seed.ts)
		const h = React.createElement

		// ─────────────────────────────────────────────────────────────────────
		// 0. Brand constants — placeholder identity for General Agentics.
		//    Replace the SVG paths here (and brand/*.svg) with official
		//    artwork when available; nothing else needs to change.
		// ─────────────────────────────────────────────────────────────────────

		const PRODUCT_NAME = 'General Agentics'
		const PRODUCT_SHORT_NAME = 'GA'

		/** Brand accent. Placeholder indigo; swap per brand guidelines. */
		const BRAND_COLOR = { light: '#4F46E5', dark: '#818CF8' }
		const FAVICON_COLOR = '#5B54E8'

		/**
		 * The GA placeholder mark: three nodes of an agent graph joined as a
		 * triangle (drawn stroke-first, node circles last so joints vanish).
		 * Uses currentColor so it follows the surrounding label color, the
		 * same convention as the official FishLogo.
		 */
		function GAMark({ size = 24, className }) {
			return h('svg', {
				width: size,
				height: size,
				viewBox: '0 0 24 24',
				fill: 'none',
				'aria-hidden': 'true',
				className,
			},
			h('path', { d: 'M12 5 5 17.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
			h('path', { d: 'M12 5 19 17.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
			h('path', { d: 'M5 17.5h14', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
			h('circle', { cx: 12, cy: 5, r: 2.7, fill: 'currentColor' }),
			h('circle', { cx: 5, cy: 17.5, r: 2.7, fill: 'currentColor' }),
			h('circle', { cx: 19, cy: 17.5, r: 2.7, fill: 'currentColor' }))
		}

		/**
		 * The GA placeholder wordmark. The host's `.brandName` container owns
		 * font size/height/gap; this span only carries weight and tracking.
		 */
		function GAName() {
			return h('span', {
				style: { fontWeight: 600, letterSpacing: '0.01em', whiteSpace: 'nowrap' },
			}, PRODUCT_NAME)
		}

		/**
		 * Text-only logo for the conversation hero: the homepage keeps just
		 * the "General Agentics" wordmark, no graphic mark. The hero owner
		 * passes {size, className}; the text ignores size (the hero headline
		 * scale applies) but accepts the props so the seat contract holds.
		 */
		function GAHeroWordmark({ className }) {
			return h('span', {
				className,
				style: { fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' },
			}, PRODUCT_NAME)
		}

		// ─────────────────────────────────────────────────────────────────────
		// 1. Tab-level rebrand (title / favicon / manifest)
		// ─────────────────────────────────────────────────────────────────────

		const EM = '\u2014' // the em dash the shell's DocumentTitle uses
		const OLD_PRODUCTS = ['DeepSeek Harness', 'DSH Local Build']

		function rewriteTitle() {
			const t = document.title
			if (!t) { document.title = PRODUCT_NAME; return }
			if (t === PRODUCT_NAME) return
			// Bare old product title (no session prefix).
			if (OLD_PRODUCTS.includes(t) || t === 'DSH') { document.title = PRODUCT_NAME; return }
			// "<session> — <old product>" → "<session> — General Agentics"
			const idx = t.lastIndexOf(` ${EM} `)
			if (idx !== -1) {
				const suffix = t.slice(idx + EM.length + 2)
				if (OLD_PRODUCTS.includes(suffix) || /^DSH(?:\s|$)/.test(suffix)) {
					const next = `${t.slice(0, idx)} ${EM} ${PRODUCT_NAME}`
					if (next !== t) document.title = next
				}
			}
			// Anything else: a session-specific title the shell (or the user)
			// owns — leave it alone.
		}

		function faviconHref() {
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">`
				+ `<rect width="24" height="24" rx="5" fill="#14151A"/>`
				+ `<path d="M12 5 5 17.5M12 5 19 17.5M5 17.5h14" stroke="${FAVICON_COLOR}" stroke-width="1.7" stroke-linecap="round" fill="none"/>`
				+ `<circle cx="12" cy="5" r="2.7" fill="${FAVICON_COLOR}"/>`
				+ `<circle cx="5" cy="17.5" r="2.7" fill="${FAVICON_COLOR}"/>`
				+ `<circle cx="19" cy="17.5" r="2.7" fill="${FAVICON_COLOR}"/>`
				+ `</svg>`
			return `data:image/svg+xml,${encodeURIComponent(svg)}`
		}

		/** Swap every icon link to the GA favicon; restore on dispose. */
		function installFavicon() {
			const href = faviconHref()
			const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel~="icon"]'))
			const saved = links.map(link => ({
				link,
				href: link.getAttribute('href'),
				type: link.getAttribute('type'),
				media: link.getAttribute('media'),
			}))
			for (const link of links) {
				link.removeAttribute('media') // collapse the light/dark pair into one
				link.setAttribute('type', 'image/svg+xml')
				link.setAttribute('href', href)
			}
			let created = null
			if (links.length === 0) {
				created = document.createElement('link')
				created.rel = 'icon'
				created.type = 'image/svg+xml'
				created.href = href
				document.head.appendChild(created)
			}
			return () => {
				for (const s of saved) {
					if (s.href === null) s.link.removeAttribute('href')
					else s.link.setAttribute('href', s.href)
					if (s.type === null) s.link.removeAttribute('type')
					else s.link.setAttribute('type', s.type)
					if (s.media === null) s.link.removeAttribute('media')
					else s.link.setAttribute('media', s.media)
				}
				if (created !== null) created.remove()
			}
		}

		/** Best-effort: PWA install name follows the manifest, which is a
		 *  static file in the shipped dist. Rewriting the link to a data URI
		 *  covers fresh installs where the browser honors it. */
		function installManifest() {
			try {
				const link = document.querySelector('link[rel="manifest"]')
				if (!link) return () => {}
				const prev = link.getAttribute('href')
				const manifest = {
					name: PRODUCT_NAME,
					short_name: PRODUCT_SHORT_NAME,
					start_url: './',
					scope: './',
					display: 'fullscreen',
					icons: [{ src: faviconHref(), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
				}
				link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`
				return () => { if (prev !== null) link.setAttribute('href', prev) }
			} catch {
				return () => {} /* best-effort only */
			}
		}

		function installTabBrand() {
			rewriteTitle()
			const undoFavicon = installFavicon()
			const undoManifest = installManifest()
			// Re-assert whenever the shell's DocumentTitle effect (or anything
			// else) rewrites the title. Our own writes are no-ops on re-run,
			// so this cannot loop.
			const observer = new MutationObserver(rewriteTitle)
			observer.observe(document.head, { childList: true, characterData: true, subtree: true })
			return () => {
				observer.disconnect()
				undoManifest()
				undoFavicon()
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// 2. Hero tagline — an attribution line, not a slogan
		// ─────────────────────────────────────────────────────────────────────

		/**
		 * The official hero renders its own tagline beside the brand slot we
		 * occupy. For a white-label deployment that tagline is the upstream
		 * product's voice speaking on our homepage, so it is replaced with an
		 * attribution line: accurate, owed, and consistent with the accepted
		 * developer-facing phrasing ("Built on DeepSeek Harness (DSH)").
		 * Baked into the shipped dist like the tab title, so runtime rewrite
		 * is the only bundle-level reach.
		 */
		const HERO_TAGLINE = 'Powered by DeepSeek Harness'
		const OLD_TAGLINES = ['Into the Unknown']

		function rewriteTagline() {
			// Leaf nodes only: the tagline is its own text element, and matching
			// leaves keeps us from touching any user content that happens to
			// quote the phrase.
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
			let node
			while ((node = walker.nextNode())) {
				const text = node.textContent.trim()
				if (OLD_TAGLINES.includes(text)) node.textContent = HERO_TAGLINE
			}
		}

		function installHeroTagline() {
			rewriteTagline()
			const observer = new MutationObserver(rewriteTagline)
			observer.observe(document.body, { childList: true, characterData: true, subtree: true })
			return () => observer.disconnect()
		}

		// ─────────────────────────────────────────────────────────────────────
		// 3. Starter modules under the composer
		// ─────────────────────────────────────────────────────────────────────

		/**
		 * Onboarding strip below the conversation composer. Each module is one
		 * of the methodologies this bundle ships as a skill, phrased as the
		 * outcome a new user wants; activating one seeds the composer with a
		 * starter sentence, so the first message already follows the method.
		 *
		 * Deliberately plain: text only, hairline borders, no icons and no
		 * emoji. Colours come from the platform's own alias tokens so the
		 * strip follows light/dark and picks up the brand accent for free.
		 */
		const STARTER_MODULES = [
			{
				title: 'Plan',
				desc: 'Turn a goal into a reviewed, step-by-step plan before any code.',
				prompt: 'I want to build: … — write an implementation plan first, and do not write code until I approve it.',
			},
			{
				title: 'Test first',
				desc: 'Capture the expected behaviour in a failing test, then make it pass.',
				prompt: 'Before implementing anything, write tests that capture the expected behaviour of: …',
			},
			{
				title: 'Debug',
				desc: 'Trace to the root cause before any fix is proposed.',
				prompt: 'Something is broken: … — find and explain the root cause before suggesting a fix.',
			},
			{
				title: 'Verify',
				desc: 'Run the checks and read the output before anything is called done.',
				prompt: 'Verify the current change: run the relevant checks and tell me exactly what the output says.',
			},
			{
				title: 'What can this do?',
				desc: 'List the bundled skills and plugins of this deployment.',
				prompt: 'What is this deployment? List the bundled skills and plugins and what each one is for.',
			},
		]

		/**
		 * Put text into whatever editor the composer uses. The stock composer is
		 * a React-owned contenteditable div, and `execCommand('insertText')`
		 * only lands when a selection already sits inside it — focusing alone is
		 * not enough (measured 2026-10-13: without the collapsed range the
		 * insert silently does nothing). Place a caret at the end first, then
		 * insert; fall back to a textarea value write if the editor ever is one.
		 */
		function seedComposer(text) {
			const editable = document.querySelector('textarea[placeholder^="Describe"], [contenteditable="true"][data-placeholder^="Describe"], [contenteditable="true"]')
			if (editable === null) return false
			editable.focus()
			if (editable.tagName !== 'TEXTAREA') {
				const range = document.createRange()
				range.selectNodeContents(editable)
				range.collapse(false)
				const selection = window.getSelection()
				selection.removeAllRanges()
				selection.addRange(range)
			}
			let done = false
			try { done = document.execCommand('insertText', false, text) } catch { done = false }
			if (!done && editable.tagName === 'TEXTAREA') {
				editable.value = text
				editable.dispatchEvent(new Event('input', { bubbles: true }))
				done = true
			}
			return done
		}

		function buildModulesStrip() {
			const strip = document.createElement('div')
			strip.setAttribute('data-ga-modules', '')
			strip.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px;margin:12px 0 0;width:100%;'
			const label = document.createElement('div')
			label.textContent = 'START HERE'
			label.style.cssText = 'grid-column:1/-1;font-size:10px;font-weight:600;letter-spacing:.09em;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.8));'
			strip.appendChild(label)
			for (const module of STARTER_MODULES) {
				const card = document.createElement('button')
				card.type = 'button'
				card.style.cssText = 'display:block;text-align:left;font:inherit;cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28));border-radius:10px;padding:10px 12px;'
				const title = document.createElement('div')
				title.textContent = module.title
				title.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);'
				const desc = document.createElement('div')
				desc.textContent = module.desc
				desc.style.cssText = 'margin-top:2px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.8));'
				card.append(title, desc)
				card.addEventListener('mouseenter', () => {
					card.style.borderColor = 'var(--dsw-alias-brand-primary,#4F46E5)'
					title.style.color = 'var(--dsw-alias-brand-primary,#4F46E5)'
				})
				card.addEventListener('mouseleave', () => {
					card.style.borderColor = 'var(--dsw-alias-border-secondary,rgba(128,128,128,.28))'
					title.style.color = 'var(--dsw-alias-label-primary,inherit)'
				})
				card.addEventListener('click', () => { seedComposer(module.prompt) })
				strip.appendChild(card)
			}
			return strip
		}

		/**
		 * The composer placeholder is the platform's own home/conversation
		 * discriminator: the welcome surface uses "Describe what you want to
		 * build…" while an open conversation uses "Message or run a task…".
		 * The composer DOM node is reused across navigation (only its
		 * placeholder changes), so the strip must be REMOVED when the home
		 * composer is gone — inserting once and never tearing down is the bug
		 * this fixes (the strip used to follow the user into conversations).
		 */
		const HOME_COMPOSER_SELECTOR = '[placeholder^="Describe"], [data-placeholder^="Describe"]'

		/**
		 * Anchor: the composer card. Found through its placeholder text, then
		 * widened to the bordered box that wraps it. The shell remounts the
		 * conversation view on navigation, so a MutationObserver re-asserts (or
		 * withdraws) the strip; the data attribute keeps that idempotent.
		 */
		function installStarterModules() {
			const strip = () => document.querySelector('[data-ga-modules]')
			const place = () => {
				const holder = document.querySelector(HOME_COMPOSER_SELECTOR)
				if (holder === null) {
					strip()?.remove() // left the home surface — take the strip with us
					return
				}
				if (strip() !== null) return
				let card = holder
				for (let i = 0; i < 6 && card.parentElement !== null; i++) {
					card = card.parentElement
					const style = getComputedStyle(card)
					if (style.borderRadius !== '0px' && card.getBoundingClientRect().width > 320) break
				}
				card.parentElement.insertBefore(buildModulesStrip(), card.nextSibling)
			}
			place()
			const observer = new MutationObserver(place)
			observer.observe(document.body, {
				childList: true,
				subtree: true,
				// The home → conversation switch can be nothing but a
				// placeholder attribute change on the reused composer node.
				attributes: true,
				attributeFilter: ['placeholder', 'data-placeholder'],
			})
			return () => {
				observer.disconnect()
				strip()?.remove()
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// 3b. Settings panel — what this bundle contains, and how to update it
		// ─────────────────────────────────────────────────────────────────────

		/**
		 * The bundle ships thirteen third-party plugins and fourteen skills, and
		 * nothing in the stock UI lists them: a user cannot tell which curated
		 * plugin is installed, which has a newer release, or that a plugin is
		 * missing because a `link:` install never installs the bundle's own
		 * dependencies. This panel answers that from the host-half endpoint
		 * (/api/general-agentics/status) and can ask the plugin manager to
		 * update the bundle.
		 *
		 * Minimal by design, like the START HERE strip: text, hairline borders,
		 * alias tokens, no emoji, no icon fonts.
		 */
		const STATUS_URL = '/api/general-agentics/status'

		function gaBadge(text, tone) {
			const color = tone === 'warn'
				? 'var(--dsw-alias-state-warn-primary,#B45309)'
				: tone === 'ok'
					? 'var(--dsw-alias-state-success-primary,#15803D)'
					: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))'
			return h('span', {
				style: { marginLeft: '6px', padding: '1px 6px', borderRadius: '999px', fontSize: '10.5px', border: '1px solid currentColor', color },
			}, text)
		}

		function GASettingsPanel() {
			const [data, setData] = React.useState(null)
			const [error, setError] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [result, setResult] = React.useState(null)
			const [confirming, setConfirming] = React.useState(false)

			const load = React.useCallback(async () => {
				try {
					const response = await fetch(`${STATUS_URL}?plugins=1`, { headers: { accept: 'application/json' } })
					if (!response.ok) throw new Error(`HTTP ${response.status}`)
					setData(await response.json())
					setError(null)
				} catch (cause) {
					setError(String(cause?.message ?? cause))
				}
			}, [])

			React.useEffect(() => { load() }, [load])

			const runUpdate = async () => {
				setBusy(true)
				setConfirming(false)
				setResult(null)
				try {
					const response = await fetch(STATUS_URL, { method: 'POST' })
					setResult(await response.json())
				} catch (cause) {
					setResult({ ok: false, error: String(cause?.message ?? cause) })
				} finally {
					setBusy(false)
					load()
				}
			}

			const card = { border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))', borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' }
			const label = { fontSize: '10px', fontWeight: 600, letterSpacing: '.09em', color: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.8))', marginBottom: '6px' }
			const muted = { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.85))' }
			const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px' }
			const button = {
				font: 'inherit', fontSize: '12px', padding: '4px 10px', borderRadius: '8px', cursor: 'pointer',
				background: 'transparent', color: 'var(--dsw-alias-brand-primary,#4F46E5)',
				border: '1px solid var(--dsw-alias-brand-primary,#4F46E5)',
			}
			const row = { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))' }

			const children = []
			children.push(h('div', { key: 'title', style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' } },
				h('div', { style: { fontSize: '14px', fontWeight: 600 } }, PRODUCT_NAME),
				data ? h('span', { style: { ...muted, ...mono } }, data.current) : null,
				data?.updateAvailable ? gaBadge(`可更新 ${data.latest}`, 'warn') : null,
				data !== null && data.updateAvailable !== true && data.localAhead === true ? gaBadge('本地版本領先 registry', 'muted') : null,
				data !== null && data.updateAvailable !== true && data.localAhead !== true ? gaBadge('已是最新', 'ok') : null))

			if (error !== null) children.push(h('div', { key: 'err', style: { ...card, ...muted } }, `無法取得狀態：${error}`))
			if (data === null && error === null) children.push(h('div', { key: 'loading', style: { ...card, ...muted } }, '讀取中…'))

			if (data !== null) {
				const actions = []
				if (data.updateAvailable) {
					actions.push(confirming
						? h('span', { key: 'confirm' },
							h('span', { style: { ...muted, marginRight: '8px' } }, '確定要更新整個 bundle？'),
							h('button', { key: 'go', style: button, onClick: runUpdate, disabled: busy }, busy ? '更新中…' : '確定'),
							h('button', { key: 'no', style: { ...button, color: 'var(--dsw-alias-label-tertiary)', borderColor: 'var(--dsw-alias-border-secondary)' }, onClick: () => setConfirming(false) }, '取消'))
						: h('button', { key: 'ask', style: button, onClick: () => setConfirming(true) }, '更新 bundle'))
				}
				children.push(h('div', { key: 'actions', style: card },
					h('div', { style: label }, 'BUNDLE'),
					h('div', { style: { ...muted, marginBottom: '8px' } },
						`${data.curated.length} 個精選插件、${data.skills.length} 個技能`,
						data.profile?.devInstall ? '　·　此 profile 為 link: 開發安裝，更新會改用 registry 版本'
							: data.profile?.frozenInstall ? '　·　此 profile 為 tarball 快照安裝，更新會改用 registry 版本' : ''),
					actions.length > 0 ? h('div', { key: 'a', style: { marginBottom: '8px' } }, actions) : null,
					h('div', { style: label }, '手動指令（可複製）'),
					h('code', { style: { ...mono, display: 'block', padding: '6px 8px', borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover-accent,rgba(128,128,128,.10))', userSelect: 'text' } }, data.updateCommand),
					result !== null ? h('div', { key: 'result', style: { ...muted, marginTop: '8px' } },
						result.ok === true
							? (result.restartRequired ? '更新已套用，需重啟 App 生效。' : '更新已套用。')
							: `未自動更新${result.reason ? `（${result.reason}）` : ''}：請執行上面的指令。`) : null))

				children.push(h('div', { key: 'plugins', style: card },
					h('div', { style: label }, `精選插件（${data.curated.length}）`),
					...data.curated.map(plugin => h('div', { key: plugin.name, style: row },
						h('div', { style: { minWidth: 0 } },
							h('div', { style: { fontSize: '12px', wordBreak: 'break-all' } }, plugin.name),
							h('div', { style: { ...muted, ...mono } }, plugin.spec)),
						h('div', { style: { ...muted, ...mono, textAlign: 'right', whiteSpace: 'nowrap' } },
							plugin.installed ?? '未安裝',
							plugin.updateAvailable ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary,#B45309)' } }, ` → ${plugin.latest}`) : null),
						h('div', { style: { textAlign: 'right' } },
							plugin.installed === undefined
								? gaBadge('未提供', 'warn')
								: plugin.updateAvailable ? gaBadge('有新版', 'warn') : gaBadge('最新', 'ok'))))))

				children.push(h('div', { key: 'skills', style: card },
					h('div', { style: label }, `隨附技能（${data.skills.length}）`),
					h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
						...data.skills.map(name => h('span', {
							key: name,
							style: { ...mono, padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))' },
						}, name)))))

				if (data.curated.some(plugin => plugin.installed === undefined)) {
					children.push(h('div', { key: 'hint', style: { ...card, ...muted } },
						'標示「未提供」的插件不在這個 profile 裡：bundle 以 link: 安裝時，pnpm 不會安裝它的依賴。修法：把該插件直裝，或改用 registry／tarball 安裝本 bundle。'))
				}
			}

			return h('div', { style: { padding: '4px 2px 24px' } }, ...children)
		}

		// ─────────────────────────────────────────────────────────────────────
		// 4. Plugin entry
		// ─────────────────────────────────────────────────────────────────────

		function apply(ctx) {
			// Brand slots: one inject seat per slot. `slots.inject` waits for
			// the slot's declaring entry regardless of boot order; the
			// callback returns register's disposer so unloading this plugin
			// restores the previous occupant (official brand at priority 0).
			const seats = [
				['sidebar.brand.mark', GAMark],
				['sidebar.brand.name', GAName],
				// Homepage: text logo only — the wordmark replaces the graphic mark.
			['conversation.hero.brand.mark', GAHeroWordmark],
			]
			for (const [key, Component] of seats) {
				ctx.slots.inject(key, () =>
					ctx.slots.register({ name: key, priority: -1 }, Component))
			}

			// Brand accent tokens. Contract: every override needs both modes.
			ctx.effect(() => ctx.theme.overrideTokens('general-agentics', {
				'--dsw-alias-brand-primary': { light: BRAND_COLOR.light, dark: BRAND_COLOR.dark },
				'--dsw-alias-brand-text': { light: BRAND_COLOR.light, dark: BRAND_COLOR.dark },
			}), 'general-agentics: theme tokens')

			// Tab-level rebrand (title suffix / favicon / manifest).
			ctx.effect(installTabBrand, 'general-agentics: tab brand')

			// Hero attribution line in place of the upstream tagline.
			ctx.effect(installHeroTagline, 'general-agentics: hero tagline')

			// Onboarding modules under the composer.
			ctx.effect(installStarterModules, 'general-agentics: starter modules')

			// Settings → a section listing what this bundle contains, with the
			// bundle version, per-plugin status and the update action. The slot
			// is a navigation entry, hence the `label` (what the sidebar shows)
			// and an `order` that keeps it below the built-in sections.
			ctx.slots.inject('settings.section', () =>
				ctx.slots.register({
					name: 'settings.section',
					id: 'general-agentics',
					order: 40,
					label: () => PRODUCT_NAME,
				}, GASettingsPanel))
		}

		const exports = {}
		exports.name = 'general-agentics'
		exports.inject = ['slots', 'theme']
		exports.apply = apply
		/** Console/debug seam: the identity this half installs. */
		exports.__brand = { PRODUCT_NAME, PRODUCT_SHORT_NAME, BRAND_COLOR }
		return exports
	},
})
