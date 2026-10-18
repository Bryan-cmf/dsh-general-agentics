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

		/** D1: selectable accents, both modes so light/dark stay coherent. */
		const ACCENT_COLORS = {
			indigo: { light: '#4F46E5', dark: '#818CF8' },
			teal: { light: '#0F766E', dark: '#2DD4BF' },
			amber: { light: '#B45309', dark: '#FBBF24' },
			rose: { light: '#BE123C', dark: '#FB7185' },
		}
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

		/** Set when the status says something needs attention; the tab title says so. */
		let titleAttention = false

		/** Focus/hover states for controls that only have inline styles. */
		function interactive(base, { hover = 'var(--dsw-alias-interactive-bg-hover-accent, rgba(128,128,128,.10))' } = {}) {
			return {
				style: base,
				onMouseEnter: event => { event.currentTarget.style.background = hover },
				onMouseLeave: event => { event.currentTarget.style.background = base.background ?? 'transparent' },
				onFocus: event => {
					event.currentTarget.style.outline = '2px solid var(--dsw-alias-brand-primary,#4F46E5)'
					event.currentTarget.style.outlineOffset = '1px'
				},
				onBlur: event => { event.currentTarget.style.outline = 'none' },
			}
		}

		/** Prefix/strip the attention dot without touching the rest of the title. */
		function applyTitleMarker() {
			const base = String(document.title ?? '').replace(/^●\s*/u, '')
			const wanted = titleAttention && base !== '' ? `● ${base}` : base
			if (document.title !== wanted) document.title = wanted
		}

		function rewriteTitle() {
			// The tab is visible even when Settings is closed; a leading dot is the
			// cheapest "something needs attention" signal that needs no slot.
			rewriteTitleBase()
			applyTitleMarker()
		}

		function rewriteTitleBase() {
			const marker = (attention) => attention ? `● ${PRODUCT_NAME}` : PRODUCT_NAME
			const t = document.title
			if (!t) { document.title = marker(titleAttention); return }
			const branded = marker(titleAttention)
			// Assign only on a real change: the head observer fires on every title
			// write, so an unconditional assignment here is an infinite loop
			// (observed live: 22 browser processes at 800% CPU, page never loaded).
			if (t === branded || t === PRODUCT_NAME) {
				if (document.title !== branded) document.title = branded
				return
			}
			// Bare old product title (no session prefix).
			if (OLD_PRODUCTS.includes(t) || t === 'DSH') { document.title = branded; return }
			// "<session> — <old product>" → "<session> — General Agentics"
			const idx = t.lastIndexOf(` ${EM} `)
			if (idx !== -1) {
				const suffix = t.slice(idx + EM.length + 2)
				if (OLD_PRODUCTS.includes(suffix) || /^DSH(?:\s|$)/.test(suffix)) {
					const next = `${t.slice(0, idx)} ${EM} ${branded}`
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

		/**
		 * Coalesce DOM reactions to at most one run per animation frame. The chat
		 * surface mutates per streamed token, so a raw observer callback that walks
		 * the document runs thousands of times per answer.
		 */
		function gaCoalesce(run) {
			let queued = false
			const fire = () => { queued = false; run() }
			return () => {
				if (queued) return
				queued = true
				if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fire)
				else window.setTimeout(fire, 16)
			}
		}

		/** Observable from the console, and used by the verification harness. */
		const GA_DIAG = { taglineFlushes: 0, taglineWalks: 0, placeFlushes: 0, placeSkips: 0 }
		try { window.__DSH_GA_DIAG__ = GA_DIAG } catch { /* non-browser */ }

		/**
		 * Leaf nodes only: the tagline is its own text element, and matching
		 * leaves keeps us from touching any user content that happens to
		 * quote the phrase.
		 */
		const rewriteTextIn = root => {
				GA_DIAG.taglineWalks++
				if (root.nodeType === Node.TEXT_NODE) {
					if (OLD_TAGLINES.includes(root.textContent.trim())) root.textContent = HERO_TAGLINE
					return
				}
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
				let node
				while ((node = walker.nextNode())) {
					if (OLD_TAGLINES.includes(node.textContent.trim())) node.textContent = HERO_TAGLINE
				}
			}

			function installHeroTagline() {
				rewriteTextIn(document.body)
				// Only the nodes the mutation actually touched are walked, and the
				// reactions are coalesced: a streamed answer can emit hundreds of
				// records per second and this stays at one pass per frame.
				const pending = []
				const flush = gaCoalesce(() => {
					GA_DIAG.taglineFlushes++
					for (const record of pending.splice(0)) {
						if (record.type === 'characterData') rewriteTextIn(record.target)
						else for (const node of record.addedNodes) rewriteTextIn(node)
					}
				})
				const observer = new MutationObserver(records => {
					pending.push(...records)
					flush()
				})
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
				skills: ['brainstorming', 'writing-plans', 'executing-plans'],
				prompt: 'I want to build: … — write an implementation plan first, and do not write code until I approve it.',
			},
			{
				title: 'Test first',
				desc: 'Capture the expected behaviour in a failing test, then make it pass.',
				skills: ['test-driven-development'],
				prompt: 'Before implementing anything, write tests that capture the expected behaviour of: …',
			},
			{
				title: 'Debug',
				desc: 'Trace to the root cause before any fix is proposed.',
				skills: ['systematic-debugging'],
				prompt: 'Something is broken: … — find and explain the root cause before suggesting a fix.',
			},
			{
				title: 'Verify',
				desc: 'Run the checks and read the output before anything is called done.',
				skills: ['verification-before-completion', 'requesting-code-review'],
				prompt: 'Verify the current change: run the relevant checks and tell me exactly what the output says.',
			},
			{
				title: 'What can this do?',
				desc: 'List the bundled skills and plugins of this deployment.',
				skills: ['ga-identity'],
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
				if (Array.isArray(module.skills) && module.skills.length > 0) {
					// B2: the capability map — each entry names the bundled skills it draws on.
					const uses = document.createElement('div')
					uses.textContent = t('modules_skills') + module.skills.join(' · ')
					uses.style.cssText = 'margin-top:6px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.65));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
					card.appendChild(uses)
				}
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
				if (strip() !== null) { GA_DIAG.placeSkips++; return }
				let card = holder
				for (let i = 0; i < 6 && card.parentElement !== null; i++) {
					card = card.parentElement
					const style = getComputedStyle(card)
					if (style.borderRadius !== '0px' && card.getBoundingClientRect().width > 320) break
				}
				card.parentElement.insertBefore(buildModulesStrip(), card.nextSibling)
			}
			place()
			// Same reasoning as the tagline: one placement per frame, not per record.
			const schedule = gaCoalesce(() => { GA_DIAG.placeFlushes++; place() })
			const observer = new MutationObserver(schedule)
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

		// ── i18n ─────────────────────────────────────────────────────────────
		// Two dictionaries, one key set. The language follows the browser unless
		// localStorage pins it (`general-agentics/lang` = zh|en), which is also how
		// the verification harness screenshots both languages.
		/* GA_I18N_START */
		const GA_I18N = {
			zh: {
				cat_search: '搜尋與視覺',
				cat_surface: '介面與側欄',
				cat_mobile: '行動、市集與監看',
				cat_own: '自家工具',
				cat_im: '即時通訊',
				cat_other: '其他',
				forbidden: '授權已過期，請按「重新檢查」後再試。',
				state_attention: '{n} 項待處理',
				state_current: '已是最新',
				state_update: '可更新 {v}',
				state_registry_unknown: 'registry 未知',
				registry_unknown: '無法連上 registry（稍後再試，或用下面的指令手動更新）',
				counts: '{plugins} 個插件 · {skills} 個技能',
				checked_at: '· 檢查於 {time}',
				loading: '讀取中…',
				refresh: '重新檢查',
				retry: '重試',
				status_error: '無法取得狀態：{err}',
				skeleton_title: '正在讀取狀態…',
				intro_title: '這個 BUNDLE 給了你什麼',
				intro_brand: '品牌貼牌：側欄字標、對話首頁致敬行、分頁標題與 favicon',
				intro_plugins: '{plugins} 個精選插件 + {skills} 個隨附技能，隨套件安裝與更新',
				intro_panel: '這個面板：版本狀態、前置條件、一鍵更新與診斷',
				intro_mcp: 'MCP 工具 ga_bundle_info／ga_health_check，供 agent 自查',
				got_it: '知道了',
				missing_dep: '缺少依賴',
				copied: '已複製',
				copy_fix: '複製修法',
				not_provided_hint: '這個 profile 沒有提供它（bundle 以 link: 安裝時不會帶入依賴）',
				not_provided: '未提供',
				copy_install: '複製安裝指令',
				dup_hint: '這個 profile 也直裝了一份：會啟用兩次，且它自己的設定覆蓋行不生效',
				dup_badge: '直裝重複',
				confirm: '確定',
				cancel: '取消',
				install_dev: '此 profile 為 link: 開發安裝，更新會改用 registry 版本',
				install_frozen: '此 profile 為 tarball 快照安裝，更新會改用 registry 版本',
				local_ahead: '本地版本領先 registry（尚未發佈）',
				up_to_date_version: '已是最新版本',
				restart_suffix: '，重啟 App 後生效。',
				already_current: '已經是最新版本。',
				registry_unreachable: '無法連上 registry，請稍後再試或用下面的指令。',
				not_updated: '未自動更新',
				run_command: '：請執行下面的指令。',
				transient_warn: '（切換瞬間有插件回報錯誤，重啟後應恢復）',
				manual_command: '手動指令',
				copy: '複製',
				search_placeholder: '搜尋插件…',
				search_aria: '搜尋插件',
				empty_list: '沒有符合條件的插件。',
				badge_update: '有新版',
				badge_checking: '查詢中',
				badge_latest: '最新',
				unknown: '未知',
				behind_why: '落後原因：bundle 的 floor 尚未提高到該版本（提高 floor 的發佈才會帶動既有安裝）。',
				npm_page: 'npm 頁面',
				collapse: '收合',
				expand: '展開詳情',
				prereq_title: '前置條件（無法隨 npm 套件提供）',
				ready: '已就緒',
				check_yourself: '需自行確認',
				attention_title: '需要注意（{n}）',
				updating: '更新中… 已 {s}s（會先卸載再安裝，通常 10–60 秒；完成後面板自動更新）',
				confirm_update: '確定更新到 {v}？（過程中插件會暫時消失）',
				update_to: '更新到 {v}',
				available_msg: '有新版本 {v} 可更新',
				applied: '更新已套用{v}',
				filter_all: '全部 {n}',
				filter_update: '有新版 {n}',
				filter_attention: '需注意 {n}',
				filter_missing: '未提供 {n}',
				list_title: '精選插件（顯示 {visible}／{total}）',
				detail_versions: '宣告 {spec} · 已裝 {installed} · registry {latest}',
				group_title: '{title}（{n}）',
				dot: '。',
				version_paren: '（{v}）',
				rollback_to: '回到 {v}',
				rollback_confirm: '確定回到 {v}？（會先卸載再安裝，過程中插件會暫時消失）',
				preview_title: '這次更新會改變：',
				preview_none: '相依範圍沒有變動（只更新自身程式碼與技能）。',
				preview_failed: '無法取得更新預覽，仍可直接更新。',
				preview_loading: '正在取得更新內容…',
				preview_added: '新增',
				preview_removed: '移除',
				preview_changed: '變更',
				quiet_title: '提醒時段',
				quiet_hint: '以伺服器時間為準；靜默時段內不顯示側欄的更新小點（不會自動更新任何東西）。',
				quiet_off: '不靜默',
				quiet_night: '22:00–08:00',
				quiet_work: '09:00–18:00',
				quiet_saved: '已儲存',
				badge_update_title: '更新可用：{v}',
				badge_attention_title: '{n} 項待處理',
				tab_status: '狀態',
				tab_plugins: '插件',
				tab_skills: '技能',
				tab_settings: '設定',
				skills_search: '搜尋技能…',
				skills_show_all: '顯示全部 {n} 個',
				skills_show_less: '收合',
				skills_try: '試用',
				skills_prompt: 'Use the "{name}" skill for this task: ',
				modules_skills: '技能：',
				plugin_badge: 'GA 精選',
				plugin_badge_title: '由 General Agentics bundle 精選並隨套件更新',
				health_title: '健康與使用',
				health_score: '{score} / 100（{grade}）',
				health_clean: '沒有發現問題。',
				usage_title: '最近使用',
				usage_line: '掃描 {sessions} 個 session、{calls} 次工具呼叫',
				usage_skills: '技能：{list}',
				usage_unavailable: '無法取得使用資料：{reason}',
				diag_copy: '複製診斷',
				theme_title: '品牌外觀',
				theme_hint: 'accent 會套用到整個介面的品牌色（淺色／深色都已配好）。',
				accent_indigo: '靛藍',
				accent_teal: '青綠',
				accent_amber: '琥珀',
				accent_rose: '玫瑰',
				wizard_title: '先設定三個偏好',
				wizard_lang: '介面語言',
				wizard_done: '完成',
				wizard_hint: '之後隨時可以在下面的卡片調整。',



				skills_title: '隨附技能（{n}）',
			},
			en: {
				cat_search: 'Search & vision',
				cat_surface: 'Interface & sidebar',
				cat_mobile: 'Mobile, market & watching',
				cat_own: 'First-party tools',
				cat_im: 'Messaging',
				cat_other: 'Other',
				forbidden: 'Authorization expired — press "Check again" and retry.',
				state_attention: '{n} need attention',
				state_current: 'Up to date',
				state_update: 'Update available: {v}',
				state_registry_unknown: 'Registry unreachable',
				registry_unknown: 'Cannot reach the registry (try again later, or update with the command below)',
				counts: '{plugins} plugins · {skills} skills',
				checked_at: '· checked at {time}',
				loading: 'Loading…',
				refresh: 'Check again',
				retry: 'Retry',
				status_error: 'Cannot read status: {err}',
				skeleton_title: 'Reading status…',
				intro_title: 'What this bundle gives you',
				intro_brand: 'Branding: sidebar wordmark, hero attribution, tab title and favicon',
				intro_plugins: '{plugins} curated plugins + {skills} bundled skills, installed and updated with the package',
				intro_panel: 'This panel: version status, prerequisites, one-click update and diagnostics',
				intro_mcp: 'MCP tools ga_bundle_info / ga_health_check, so agents can self-check',
				got_it: 'Got it',
				missing_dep: 'Missing requirement',
				copied: 'Copied',
				copy_fix: 'Copy fix',
				not_provided_hint: 'This profile does not provide it (a link: install does not pull the bundle dependencies)',
				not_provided: 'Not provided',
				copy_install: 'Copy install command',
				dup_hint: 'This profile also installs it directly: it activates twice and its own override rows do not apply',
				dup_badge: 'Also direct',
				confirm: 'Confirm',
				cancel: 'Cancel',
				install_dev: 'This profile is a link: development install; updating switches to the registry version',
				install_frozen: 'This profile is a tarball snapshot install; updating switches to the registry version',
				local_ahead: 'Local build is ahead of the registry (not published)',
				up_to_date_version: 'You are on the latest version',
				restart_suffix: '; restart the app to apply.',
				already_current: 'Already on the latest version.',
				registry_unreachable: 'Cannot reach the registry; try again later or use the command below.',
				not_updated: 'Not updated automatically',
				run_command: ': run the command below.',
				transient_warn: '(Plugins reported errors during the swap; a restart should settle them)',
				manual_command: 'Manual command',
				copy: 'Copy',
				search_placeholder: 'Search plugins…',
				search_aria: 'Search plugins',
				empty_list: 'No plugins match the filter.',
				badge_update: 'Update',
				badge_checking: 'Checking',
				badge_latest: 'Latest',
				unknown: 'unknown',
				behind_why: "Behind because the bundle's floor has not been raised to that version; only a release that raises the floor moves an existing install.",
				npm_page: 'npm page',
				collapse: 'Collapse',
				expand: 'Expand',
				prereq_title: 'Prerequisites (cannot ship inside an npm package)',
				ready: 'Ready',
				check_yourself: 'Check it yourself',
				attention_title: 'Needs attention ({n})',
				updating: 'Updating… {s}s elapsed (uninstall, then install; usually 10–60s — the panel refreshes when done)',
				confirm_update: 'Update to {v}? (plugins disappear briefly during the swap)',
				update_to: 'Update to {v}',
				available_msg: 'Version {v} is available',
				applied: 'Updated{v}',
				filter_all: 'All {n}',
				filter_update: 'Updates {n}',
				filter_attention: 'Attention {n}',
				filter_missing: 'Missing {n}',
				list_title: 'Curated plugins (showing {visible}/{total})',
				detail_versions: 'Declared {spec} · installed {installed} · registry {latest}',
				group_title: '{title} ({n})',
				dot: '.',
				version_paren: ' ({v})',
				rollback_to: 'Back to {v}',
				rollback_confirm: 'Go back to {v}? (uninstall then install; plugins disappear briefly)',
				preview_title: 'This update will change:',
				preview_none: 'Dependency ranges are unchanged (only the code and skills move).',
				preview_failed: 'Could not fetch the update preview; updating still works.',
				preview_loading: 'Fetching what changes…',
				preview_added: 'added',
				preview_removed: 'removed',
				preview_changed: 'changed',
				quiet_title: 'Reminders',
				quiet_hint: 'Uses the server clock; while quiet, the sidebar update dot stays hidden. Nothing updates by itself.',
				quiet_off: 'Never quiet',
				quiet_night: '22:00–08:00',
				quiet_work: '09:00–18:00',
				quiet_saved: 'Saved',
				badge_update_title: 'Update available: {v}',
				badge_attention_title: '{n} need attention',
				tab_status: 'Status',
				tab_plugins: 'Plugins',
				tab_skills: 'Skills',
				tab_settings: 'Settings',
				skills_search: 'Search skills…',
				skills_show_all: 'Show all {n}',
				skills_show_less: 'Show less',
				skills_try: 'Try',
				skills_prompt: 'Use the "{name}" skill for this task: ',
				modules_skills: 'Skills: ',
				plugin_badge: 'GA curated',
				plugin_badge_title: 'Curated by the General Agentics bundle and updated with it',
				health_title: 'Health & usage',
				health_score: '{score} / 100 ({grade})',
				health_clean: 'Nothing found.',
				usage_title: 'Recent usage',
				usage_line: '{sessions} sessions scanned, {calls} tool calls',
				usage_skills: 'Skills: {list}',
				usage_unavailable: 'Usage unavailable: {reason}',
				diag_copy: 'Copy diagnostics',
				theme_title: 'Brand appearance',
				theme_hint: 'The accent applies to the whole interface, in both light and dark.',
				accent_indigo: 'Indigo',
				accent_teal: 'Teal',
				accent_amber: 'Amber',
				accent_rose: 'Rose',
				wizard_title: 'Three quick preferences',
				wizard_lang: 'Interface language',
				wizard_done: 'Done',
				wizard_hint: 'You can change all of this later in the cards below.',



				skills_title: 'Bundled skills ({n})',
			},
		}

		/* GA_I18N_END */

		/** The client context, kept so the panel can retheme without prop drilling. */
		let gaCtx = null
		let accentDisposer = null
		function applyAccent(color) {
			try {
				// S13: the theme keeps ONE layer per source, so the previous disposer
				// becomes a no-op once a new layer replaces it. Drop the current layer
				// ourselves and remember the new one, so unloading (or switching again)
				// always removes what is actually installed.
				accentDisposer?.()
				accentDisposer = gaCtx?.theme?.overrideTokens('general-agentics', {
					'--dsw-alias-brand-primary': { light: color.light, dark: color.dark },
					'--dsw-alias-brand-text': { light: color.light, dark: color.dark },
				}) ?? null
				return accentDisposer
			} catch {
				return undefined // a missing theme service only means the default palette
			}
		}

		let GA_LANG = (() => {
			try {
				const pinned = window.localStorage.getItem('general-agentics/lang')
				if (pinned === 'zh' || pinned === 'en') return pinned
			} catch { /* private mode */ }
			try {
				return String(window.navigator?.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
			} catch { /* not a browser */ }
			return 'zh'
		})()

		/** D3: prefer the app's own locale service over sniffing the browser. */
		function adoptAppLanguage(locale) {
			try {
				const active = locale?.getSnapshot?.()?.active
				if (typeof active === 'string' && active !== '') {
					GA_LANG = active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
					try { window.__GA_LOCALE_SOURCE__ = 'service' } catch { /* non-browser */ }
					return true
				}
			} catch { /* service absent or shaped differently */ }
			try { window.__GA_LOCALE_SOURCE__ = 'browser' } catch { /* non-browser */ }
			return false
		}

		/** Translate a key; falls back to the other dictionary, then the key itself. */
		function t(key) {
			const table = GA_I18N[GA_LANG] ?? GA_I18N.zh
			return table[key] ?? GA_I18N.zh[key] ?? key
		}

		/** Translate with `{name}` interpolation. */
		function tf(key, vars = {}) {
			return t(key).replace(/\{(\w+)\}/gu, (_, name) => String(vars[name] ?? ''))
		}

		/** Fired after the panel writes settings, so the sidebar dot re-reads them. */
		const GA_STATUS_EVENT = 'general-agentics:refresh'
		const PACKAGE_NAME = 'dsh-general-agentics'

		/** How many things would a reader want to know about right now? */
		function attentionCount(payload) {
			const missing = (payload?.curated ?? []).filter(plugin => plugin.installed === undefined || plugin.alsoDirect === true).length
			const unmet = (payload?.prerequisites ?? []).filter(item => item.state === 'missing').length
			return missing + unmet
		}

		/** Reflect "something needs attention" in the tab title (and the sidebar dot). */
		function noteStatusAttention(payload) {
			const quiet = payload?.settings?.quietNow === true
			titleAttention = !quiet && (payload?.updateAvailable === true || attentionCount(payload) > 0)
			rewriteTitle()
		}

		/** One status fetch per page load, shared by the sidebar dot and the plugin badge. */
		let gaStatusPromise = null
		function gaStatusOnce() {
			if (gaStatusPromise === null) {
				gaStatusPromise = fetch(`${STATUS_URL}?plugins=1`, { headers: { accept: 'application/json' } })
					.then(response => (response.ok ? response.json() : null))
					// One place marks the tab title, so every consumer agrees on
					// whether something needs attention.
					.then(payload => { if (payload !== null) noteStatusAttention(payload); return payload })
					.catch(() => null)
			}
			return gaStatusPromise
		}

		/**
		 * Sidebar footer status (A3 follow-up): visible without opening Settings.
		 * Clicking opens the bundle's page when the plugin manager is present.
		 */
		function GASidebarStatus({ wide, hidden }) {
			const [state, setState] = React.useState(null)
			React.useEffect(() => {
				let live = true
				const read = () => {
					gaStatusPromise = null
					gaStatusOnce().then(payload => {
						if (!live || payload === null) return
						setState(payload)
						noteStatusAttention(payload)
					})
				}
				read()
				window.addEventListener(GA_STATUS_EVENT, read)
				return () => { live = false; window.removeEventListener(GA_STATUS_EVENT, read) }
			}, [])
			// The footer only exists inside the expanded sidebar, so `wide` is implied.
			if (hidden === true || state === null || state.settings?.quietNow === true) return null
			const update = state.updateAvailable === true
			const attention = attentionCount(state)
			if (!update && attention === 0) return null
			const label = update ? tf('badge_update_title', { v: state.latest }) : tf('badge_attention_title', { n: attention })
			return h('button', {
				'data-ga-footer': update ? 'update' : 'attention',
				...interactive({ font: 'inherit', fontSize: '11px', padding: '4px 8px', borderRadius: '8px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))', color: 'var(--dsw-alias-label-secondary, inherit)', display: 'inline-flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left' }),
				title: label,
				'aria-label': label,
				onClick: () => {
					try { gaCtx?.get?.('pluginNavigation')?.openBundle?.(PACKAGE_NAME) } catch { /* older shell */ }
				},
			},
				h('span', {
					style: {
						width: '6px', height: '6px', borderRadius: '999px', flex: 'none',
						background: update ? 'var(--dsw-alias-state-warn-primary,#B45309)' : 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))',
					},
				}),
				h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label))
		}

		/** "GA curated" next to a plugin's title on the Plugins page. */
		function GAPluginBadge({ subject }) {
			const [curated, setCurated] = React.useState(null)
			React.useEffect(() => { gaStatusOnce().then(payload => setCurated(payload?.curated ?? [])) }, [])
			if (curated === null || curated.length === 0) return null
			const id = subject?.name ?? subject?.id ?? subject?.pkg?.name
			if (typeof id !== 'string') return null
			if (!curated.some(plugin => plugin.name === id)) return null
			return h('span', {
				title: t('plugin_badge_title'),
				style: {
					marginInlineStart: '8px', padding: '1px 7px', borderRadius: '999px', fontSize: '10.5px',
					border: '1px solid var(--dsw-alias-brand-primary,#4F46E5)',
					color: 'var(--dsw-alias-brand-primary,#4F46E5)',
				},
			}, t('plugin_badge'))
		}

		function gaBadge(text, tone, title) {
			const color = tone === 'warn'
				? 'var(--dsw-alias-state-warn-primary,#B45309)'
				: tone === 'ok'
					? 'var(--dsw-alias-state-success-primary,#15803D)'
					: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))'
			return h('span', {
				title,
				style: {
					marginLeft: '6px', padding: '1px 7px', borderRadius: '999px', fontSize: '10.5px',
					border: '1px solid currentColor', color, whiteSpace: 'nowrap',
				},
			}, text)
		}

		/** Panels for a plugin, keyed by package name. Order is the display order. */
		const GA_CATEGORIES = [
			['search', 'cat_search', [/modsearch/u, /modlens/u, /browser-use/u]],
			['surface', 'cat_surface', [/better-sidebar/u, /dsh-context/u, /cost-meter/u, /genui/u]],
			['mobile', 'cat_mobile', [/dsh-mobile/u, /dshmarket/u, /dsh-sentinel/u]],
			['own', 'cat_own', [/dsh-comments/u, /dsh-promptimizer/u]],
			['im', 'cat_im', [/dsh-im/u]],
		]

		function gaCategoryOf(name) {
			for (const [key, title, patterns] of GA_CATEGORIES) {
				if (patterns.some(pattern => pattern.test(name))) return { key, title }
			}
			return { key: 'other', title: 'cat_other' }
		}

		const INTRO_KEY = 'general-agentics/intro-dismissed/v1'

		function GASettingsPanel() {
			const [data, setData] = React.useState(null)
			const [error, setError] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [result, setResult] = React.useState(null)
			const [confirming, setConfirming] = React.useState(false)
			const [preview, setPreview] = React.useState(null)
			const [rollingBack, setRollingBack] = React.useState(false)
			const [confirmRollback, setConfirmRollback] = React.useState(false)
			const [usage, setUsage] = React.useState(null)
			const [tab, setTab] = React.useState('status')
			const [flash, setFlash] = React.useState(null)
			const [lang, setLang] = React.useState(GA_LANG)
			const [skillQuery, setSkillQuery] = React.useState('')
			const [showAllSkills, setShowAllSkills] = React.useState(false)
			const [wizard, setWizard] = React.useState(() => {
				try { return window.localStorage.getItem('ga/wizard-done') === null } catch { return false }
			})
			const [checkedAt, setCheckedAt] = React.useState(null)
			const [filter, setFilter] = React.useState('all')
			const [query, setQuery] = React.useState('')
			const [expanded, setExpanded] = React.useState([])
			const [copied, setCopied] = React.useState(null)
			const [elapsed, setElapsed] = React.useState(0)
			const [intro, setIntro] = React.useState(() => {
				try { return window.localStorage.getItem(INTRO_KEY) === null } catch { return false }
			})

			const load = React.useCallback(async () => {
				const request = async query => {
					const response = await fetch(`${STATUS_URL}${query}`, { headers: { accept: 'application/json' } })
					if (!response.ok) throw new Error(`HTTP ${response.status}`)
					return response.json()
				}
				try {
					// Two phases: paint the cheap snapshot first (one registry call),
					// then fill the per-plugin matrix. Fourteen lookups must not hold
					// the whole panel hostage.
					setData(await request(''))
					setCheckedAt(new Date())
					setError(null)
				} catch (cause) {
					setError(String(cause?.message ?? cause))
					return
				}
				try {
					const full = await request('?plugins=1')
					setData(full)
					noteStatusAttention(full)
					setCheckedAt(new Date())
				} catch {
					/* keep the snapshot; rows say 查詢中 rather than lying */
				}
			}, [])

			React.useEffect(() => { load() }, [load])
			React.useEffect(() => {
				fetch(`${STATUS_URL}?usage=1`, { headers: { accept: 'application/json' } })
					.then(response => (response.ok ? response.json() : { ok: false, reason: `HTTP ${response.status}` }))
					.then(setUsage)
					.catch(() => setUsage({ ok: false, reason: 'fetch failed' }))
			}, [])

			// One tick per second while an update runs, so a slow install never looks dead.
			React.useEffect(() => {
				if (!busy) return undefined
				const timer = window.setInterval(() => setElapsed(value => value + 1), 1000)
				return () => window.clearInterval(timer)
			}, [busy])

			const startUpdate = async () => {
				setPreview({ loading: true })
				setConfirming(true)
				try {
					const response = await fetch(`${STATUS_URL}?preview=1`, { headers: { accept: 'application/json' } })
					setPreview(await response.json())
				} catch {
					setPreview({ ok: false })
				}
			}

			const runRollback = async () => {
				setBusy(true)
				setElapsed(0)
				setRollingBack(true)
				setResult(null)
				try {
					const response = await fetch(`${STATUS_URL}?action=rollback`, {
						method: 'POST',
						headers: { 'x-ga-csrf': String(data?.csrf ?? '') },
					})
					setResult(await response.json())
				} catch (cause) {
					setResult({ ok: false, error: String(cause?.message ?? cause) })
				} finally {
					setBusy(false)
					setRollingBack(false)
					load()
				}
			}

			const runUpdate = async () => {
				setBusy(true)
				setConfirming(false)
				setResult(null)
				setElapsed(0)
				try {
					// The host hands the token out with GET and requires it back, so a
					// cross-site page (which cannot read that response) cannot trigger
					// an install.
					const response = await fetch(STATUS_URL, {
						method: 'POST',
						headers: { 'x-ga-csrf': String(data?.csrf ?? '') },
					})
					if (response.status === 403) {
						setResult({ ok: false, code: 'forbidden', error: t('forbidden') })
						return
					}
					setResult(await response.json())
				} catch (cause) {
					setResult({ ok: false, error: String(cause?.message ?? cause) })
				} finally {
					setBusy(false)
					load()
				}
			}

			const copy = (text, key) => {
				const done = () => { setCopied(key); window.setTimeout(() => setCopied(null), 1600) }
				try {
					if (navigator.clipboard?.writeText !== undefined) {
						navigator.clipboard.writeText(text).then(done, done)
						return
					}
				} catch { /* fall through to the textarea path */ }
				const area = document.createElement('textarea')
				area.value = text
				document.body.appendChild(area)
				area.select()
				try { document.execCommand('copy') } catch { /* ignore */ }
				area.remove()
				done()
			}

			const toggle = name => setExpanded(current => current.includes(name)
				? current.filter(item => item !== name)
				: [...current, name])

			const card = { border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))', borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' }
			const label = { fontSize: '10px', fontWeight: 600, letterSpacing: '.09em', color: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.8))', marginBottom: '6px' }
			const muted = { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.85))' }
			const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px' }
			const button = {
				font: 'inherit', fontSize: '12px', padding: '4px 10px', borderRadius: '8px', cursor: 'pointer',
				background: 'transparent', color: 'var(--dsw-alias-brand-primary,#4F46E5)',
				border: '1px solid var(--dsw-alias-brand-primary,#4F46E5)',
			}
			const subtle = { ...button, color: 'var(--dsw-alias-label-tertiary)', borderColor: 'var(--dsw-alias-border-secondary,rgba(128,128,128,.35))' }
			const row = { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))' }
			const chip = active => ({
				font: 'inherit', fontSize: '11.5px', padding: '2px 9px', borderRadius: '999px', cursor: 'pointer',
				background: 'transparent',
				color: active ? 'var(--dsw-alias-brand-primary,#4F46E5)' : 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))',
				border: `1px solid ${active ? 'var(--dsw-alias-brand-primary,#4F46E5)' : 'var(--dsw-alias-border-secondary,rgba(128,128,128,.28))'}`,
			})

			const curated = data?.curated ?? []
			const behind = curated.filter(plugin => plugin.updateAvailable === true)
			const missing = curated.filter(plugin => plugin.installed === undefined)
			const duplicates = curated.filter(plugin => plugin.alsoDirect === true)
			const prerequisites = data?.prerequisites ?? []
			const missingPrereqs = prerequisites.filter(item => item.state === 'missing')
			const attention = missingPrereqs.length + missing.length + duplicates.length

			// Shared settings plumbing: the appearance card, the reminders card and
			// the first-run card all write through the same path, so they cannot
			// drift and the "Saved" flash is consistent.
			const accent = data?.settings?.accent ?? 'indigo'
			const quietWindow = data?.settings?.quietHours ?? null
			const quietKey = quietWindow === null ? 'off' : `${quietWindow.from}-${quietWindow.to}` === '22-8' ? 'night' : 'work'
			const writeSettings = async query => {
				await fetch(`${STATUS_URL}?action=settings&${query}`, {
					method: 'POST',
					headers: { 'x-ga-csrf': String(data?.csrf ?? '') },
				}).catch(() => {})
				window.dispatchEvent(new Event(GA_STATUS_EVENT))
				setFlash('saved')
				window.setTimeout(() => setFlash(null), 1600)
				load()
			}
			const swatch = key => h('button', {
				key,
				style: chip(accent === key),
				onClick: async () => {
					applyAccent(ACCENT_COLORS[key])
					await writeSettings(`accent=${key}`)
				},
			},
				h('span', {
					style: {
						display: 'inline-block', width: '8px', height: '8px', borderRadius: '999px',
						marginInlineEnd: '5px', background: ACCENT_COLORS[key].light,
					},
				}), t(`accent_${key}`))
			const quietPresets = [['off', t('quiet_off')], ['night', t('quiet_night')], ['work', t('quiet_work')]]

			const chipState = data === null ? null
				: data.latest === undefined ? { tone: 'muted', text: t('state_registry_unknown') }
					: data.updateAvailable === true ? { tone: 'warn', text: tf('state_update', { v: data.latest }) }
						: attention > 0 ? { tone: 'warn', text: tf('state_attention', { n: attention }) }
							: { tone: 'ok', text: t('state_current') }

			// Four tabs instead of one long column: the panel had grown to ten cards
			// and the answer to "is anything wrong?" was somewhere in the middle.
			const tabs = { status: [], plugins: [], skills: [], settings: [] }
			const section = (tab, node) => { tabs[tab].push(node) }
			const children = []

			// ── header ──────────────────────────────────────────────────────
			children.push(h('div', {
				key: 'head',
				style: {
					marginBottom: '10px',
					position: 'sticky',
					top: 0,
					zIndex: 2,
					paddingTop: '2px',
					background: 'var(--dsw-alias-bg-primary, inherit)',
				},
			},
				h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
					h('div', { style: { fontSize: '15px', fontWeight: 600 } }, PRODUCT_NAME),
					data ? h('span', { style: { ...muted, ...mono } }, data.current) : null,
					chipState ? gaBadge(chipState.text, chipState.tone) : null,
					data?.health ? gaBadge(tf('health_score', { score: data.health.score, grade: data.health.grade }),
						data.health.score >= 90 ? 'ok' : data.health.score >= 60 ? 'warn' : 'warn') : null),
				h('div', { style: { ...muted, marginTop: '4px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
					data ? h('span', { key: 'counts' }, tf('counts', { plugins: curated.length, skills: data.skills.length })) : h('span', { key: 'loading' }, t('loading')),
					checkedAt !== null ? h('span', { key: 'at' }, tf('checked_at', { time: checkedAt.toLocaleTimeString() })) : null,
					h('button', { key: 'refresh', style: { ...subtle, padding: '2px 8px', fontSize: '11px' }, onClick: () => { setData(null); load() }, 'aria-label': t('refresh') }, t('refresh')))))

			// Skeleton while the first (cheap) snapshot is in flight: the panel has a
			// shape immediately instead of an empty box, and nothing claims a state
			// it has not measured yet.
			if (data === null && error === null) {
				children.push(h('div', { key: 'skeleton', style: card },
					h('div', { style: label }, t('skeleton_title')),
					...[0, 1, 2].map(index => h('div', {
						key: `sk-${index}`,
						style: {
							height: '13px',
							margin: '9px 0',
							borderRadius: '4px',
							width: `${92 - index * 14}%`,
							background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(128,128,128,.12))',
						},
					}))))
			}

			if (error !== null) {
				section('status', h('div', { key: 'err', style: { ...card, ...muted, borderColor: 'var(--dsw-alias-state-warn-primary,#B45309)' } },
					tf('status_error', { err: error }), h('div', { style: { marginTop: '6px' } },
						h('button', { style: subtle, onClick: load }, t('retry')))))
			}

			// ── first run ───────────────────────────────────────────────────
			// ── attention ───────────────────────────────────────────────────
			if (attention > 0) {
				const lines = []
				const attentionRow = (key, name, hint, badge, action) => h('div', { key, style: row },
					h('div', null,
						h('div', { style: { fontSize: '12px' } }, name),
						h('div', { style: { ...muted } }, hint)),
					h('div', { style: { ...muted, textAlign: 'right' } }, badge),
					action ?? null)

				for (const item of missingPrereqs) {
					lines.push(attentionRow(`p-${item.plugin}`, item.plugin,
						GA_LANG === 'en' ? (item.needsEn ?? item.needs) : item.needs,
						t('missing_dep'),
						h('button', {
							style: { ...subtle, padding: '2px 8px', fontSize: '11px' },
							onClick: () => copy(GA_LANG === 'en' ? (item.fixEn ?? item.fix) : item.fix, `fix-${item.plugin}`),
						}, copied === `fix-${item.plugin}` ? t('copied') : t('copy_fix'))))
				}
				for (const plugin of missing) {
					lines.push(attentionRow(`m-${plugin.name}`, plugin.name, t('not_provided_hint'), t('not_provided'),
						h('button', {
							style: { ...subtle, padding: '2px 8px', fontSize: '11px' },
							onClick: () => copy(`dsh plugin --profile ${data.profile?.name ?? '<profile>'} add ${plugin.name}`, `add-${plugin.name}`),
						}, copied === `add-${plugin.name}` ? t('copied') : t('copy_install'))))
				}
				for (const plugin of duplicates) {
					lines.push(attentionRow(`d-${plugin.name}`, plugin.name, t('dup_hint'), t('dup_badge'), null))
				}
				section('status', h('div', { key: 'attention', style: { ...card, borderColor: 'var(--dsw-alias-state-warn-primary,#B45309)' } },
					h('div', { style: label }, tf('attention_title', { n: attention })),
					...lines))
			}

			// ── update ──────────────────────────────────────────────────────
			const actions = []
			if (busy) {
				actions.push(h('span', { key: 'busy', style: { ...muted } },
					tf('updating', { s: elapsed })))
			} else if (data?.updateAvailable === true) {
				actions.push(confirming
					? h('div', { key: 'confirm' },
						h('div', { style: { ...muted, marginBottom: '6px' } }, tf('confirm_update', { v: data.latest })),
						h('div', { style: { ...label, marginTop: '0' } }, t('preview_title')),
						preview === null || preview.loading === true
							? h('div', { style: muted }, t('preview_loading'))
							: preview.ok === true
								? (preview.changes.length === 0
									? h('div', { style: muted }, t('preview_none'))
									: h('div', { style: { marginBottom: '6px' } }, ...preview.changes.map(change => h('div', { key: change.name, style: { ...mono, fontSize: '11px', padding: '2px 0' } },
										h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, `${t(`preview_${change.kind}`)} `),
										`${change.name}  ${change.from ?? '—'} → ${change.to ?? '—'}`))))
								: h('div', { style: muted }, t('preview_failed')),
						h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
							h('button', { key: 'go', style: button, onClick: runUpdate, disabled: busy || preview?.loading === true }, t('confirm')),
							h('button', { key: 'no', style: subtle, onClick: () => { setConfirming(false); setPreview(null) } }, t('cancel'))))
					: h('button', { key: 'ask', style: button, onClick: startUpdate }, tf('update_to', { v: data.latest })))
			}
			if (data?.rollback !== undefined && !busy && data?.updateAvailable !== true) {
				actions.push(confirmRollback
					? h('span', { key: 'rollback-confirm' },
						h('span', { style: { ...muted, marginRight: '8px' } }, tf('rollback_confirm', { v: data.rollback.version })),
						h('button', { key: 'yes', style: button, onClick: runRollback }, t('confirm')),
						h('button', { key: 'no', style: subtle, onClick: () => setConfirmRollback(false) }, t('cancel')))
					: h('button', {
						key: 'rollback',
						style: subtle,
						onClick: () => setConfirmRollback(true),
						title: rollingBack ? t('preview_loading') : undefined,
					}, tf('rollback_to', { v: data.rollback.version })))
			}

			if (data !== null) {
				section('status', h('div', { key: 'update', style: card, 'aria-live': 'polite', role: 'status' },
					h('div', { style: label }, 'BUNDLE'),
					h('div', { style: { ...muted, marginBottom: actions.length > 0 || result !== null ? '8px' : '0' } },
						data.latest === undefined ? t('registry_unknown') : data.profile?.devInstall ? t('install_dev')
							: data.profile?.frozenInstall ? t('install_frozen')
								: data.localAhead ? t('local_ahead')
									: data.updateAvailable ? tf('available_msg', { v: data.latest }) : t('up_to_date_version')),
					actions.length > 0 ? h('div', { key: 'a', style: { marginBottom: '8px' } }, actions) : null,
					result !== null ? h('div', {
						key: 'result',
						style: {
							...muted, marginBottom: '8px', padding: '6px 8px', borderRadius: '6px',
							border: `1px solid ${result.ok === true ? 'var(--dsw-alias-state-success-primary,#15803D)' : 'var(--dsw-alias-state-warn-primary,#B45309)'}`,
						},
					},
						result.ok === true
							? tf('applied', { v: result.version ? tf('version_paren', { v: result.version }) : '' }) + (result.restartRequired ? t('restart_suffix') : t('dot'))
							: result.code === 'already-current' ? t('already_current')
								: result.code === 'registry-unreachable' ? t('registry_unreachable')
									: [t('not_updated'), result.code ? ` [${result.code}]` : '', result.error ? `: ${String(result.error).slice(0, 300)}` : '', result.manual ? t('run_command') : ''].join('')) : null,
					result !== null && result.warnings
						? h('div', { key: 'warn', style: { ...muted, marginBottom: '8px' } }, t('transient_warn'))
						: null,
					h('div', { style: label }, t('manual_command')),
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
						h('code', { style: { ...mono, flex: 1, padding: '6px 8px', borderRadius: '6px', background: 'var(--dsw-alias-interactive-bg-hover-accent,rgba(128,128,128,.10))', userSelect: 'text', overflow: 'hidden', textOverflow: 'ellipsis' } }, data.updateCommand),
						h('button', { style: { ...subtle, padding: '2px 8px', fontSize: '11px' }, onClick: () => copy(data.updateCommand, 'cmd') }, copied === 'cmd' ? t('copied') : t('copy')))))
			}

			// ── appearance (D1) ─────────────────────────────────────────────
			if (data !== null) {
				section('settings', h('div', { key: 'theme', style: card },
					h('div', { style: label }, t('theme_title')),
					h('div', { style: { ...muted, marginBottom: '6px' } }, t('theme_hint')),
					h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
						...Object.keys(ACCENT_COLORS).map(swatch))))
			}

			// ── first-run card (D2) ────────────────────────────────────────
			if (data !== null && wizard) {
					section('status', h('div', { key: 'wizard', style: { ...card, borderColor: 'var(--dsw-alias-brand-primary,#4F46E5)' } },
						h('div', { style: label }, t('wizard_title')),
						h('ul', { style: { margin: '0 0 8px', paddingLeft: '18px', fontSize: '12px', lineHeight: 1.7 } },
							h('li', { key: 'a' }, t('intro_brand')),
							h('li', { key: 'b' }, tf('intro_plugins', { plugins: curated.length, skills: data.skills.length })),
							h('li', { key: 'c' }, t('intro_panel')),
							h('li', { key: 'd' }, t('intro_mcp'))),
						h('div', { style: { ...muted, marginTop: '4px' } }, t('wizard_lang')),
						h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
							...['zh', 'en'].map(code => h('button', {
								key: code,
								style: chip(GA_LANG === code),
								onClick: () => {
									GA_LANG = code
									try { window.localStorage.setItem('general-agentics/lang', code) } catch { /* private mode */ }
									setLang(code)
								},
							}, code === 'zh' ? '中文' : 'English'))),
						h('div', { style: { ...muted, marginBottom: '4px' } }, t('theme_title')),
						h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } },
							...Object.keys(ACCENT_COLORS).map(swatch)),
						h('div', { style: { ...muted, marginBottom: '4px' } }, t('quiet_title')),
						h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } },
							...quietPresets.map(([key, text]) => h('button', {
								key,
								style: chip(quietKey === key),
								onClick: async () => {
									await writeSettings(`quiet=${key}`)
								},
							}, text))),
						h('button', {
							style: subtle,
							onClick: () => {
								try { window.localStorage.setItem('ga/wizard-done', '1') } catch { /* private mode */ }
								setWizard(false)
							},
						}, t('wizard_done'))))
				}

			// ── reminders (A3) ──────────────────────────────────────────────
			if (data !== null) {
				section('settings', h('div', { key: 'quiet', style: card },
					h('div', { style: label }, t('quiet_title')),
					h('div', { style: { ...muted, marginBottom: '6px' } }, t('quiet_hint')),
					h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
						...quietPresets.map(([key, text]) => h('button', {
							key,
							style: chip(quietKey === key),
							onClick: async () => { await writeSettings(`quiet=${key}`) },
						}, text)))))
			}

			// ── filters ─────────────────────────────────────────────────────
			if (data !== null) {
				const filters = [
					['all', tf('filter_all', { n: curated.length })],
					['update', tf('filter_update', { n: behind.length })],
					['attention', tf('filter_attention', { n: attention })],
					['missing', tf('filter_missing', { n: missing.length })],
				]
				section('plugins', h('div', { key: 'filters', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' } },
					...filters.map(([key, text]) => h('button', {
						key,
						...interactive(chip(filter === key)),
						onClick: () => setFilter(key),
						'aria-pressed': filter === key,
					}, text)),
					h('input', {
						key: 'q',
						value: query,
						onChange: event => setQuery(event.target.value),
						placeholder: t('search_placeholder'),
						'aria-label': t('search_aria'),
						style: {
							flex: 1, minWidth: '120px', font: 'inherit', fontSize: '12px', padding: '4px 8px', borderRadius: '8px',
							background: 'transparent', color: 'inherit',
							border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))',
						},
					})))
			}

			// ── plugin list ─────────────────────────────────────────────────
			if (data !== null) {
				const visible = curated.filter(plugin => {
					if (query !== '' && !plugin.name.toLowerCase().includes(query.toLowerCase())) return false
					if (filter === 'update') return plugin.updateAvailable === true
					if (filter === 'missing') return plugin.installed === undefined
					if (filter === 'attention') return plugin.installed === undefined || plugin.alsoDirect === true ||
						missingPrereqs.some(item => item.plugin === plugin.name)
					return true
				})
				const groups = []
				for (const [key, title] of GA_CATEGORIES.map(([key, title]) => [key, title])) {
					const items = visible.filter(plugin => gaCategoryOf(plugin.name).key === key)
					if (items.length > 0) groups.push([key, title, items])
				}
				const other = visible.filter(plugin => gaCategoryOf(plugin.name).key === 'other')
				if (other.length > 0) groups.push(['other', 'cat_other', other])

				section('plugins', h('div', { key: 'list', style: card },
					h('div', { style: label }, tf('list_title', { visible: visible.length, total: curated.length })),
					visible.length === 0
						? h('div', { style: { ...muted, padding: '8px 0' } }, t('empty_list'))
						: null,
					...groups.flatMap(([key, title, items]) => [
						h('div', { key: `g-${key}`, style: { ...label, marginTop: '10px', marginBottom: '2px' } }, tf('group_title', { title: t(title), n: items.length })),
						...items.map(plugin => {
							const open = expanded.includes(plugin.name)
							const rowBadge = plugin.installed === undefined ? [t('not_provided'), 'warn']
								: plugin.alsoDirect === true ? [t('dup_badge'), 'warn']
									: plugin.updateAvailable === true ? [t('badge_update'), 'warn']
										: plugin.latest === undefined ? [t('badge_checking'), 'muted']
											: [t('badge_latest'), 'ok']
							const detail = []
							detail.push(h('div', { key: 'range', style: { ...muted, ...mono } },
								tf('detail_versions', { spec: plugin.spec, installed: plugin.installed ?? '—', latest: plugin.latest ?? t('unknown') })))
							if (plugin.updateAvailable === true) {
								detail.push(h('div', { key: 'why', style: { ...muted, marginTop: '2px' } },
									t('behind_why')))
							}
							detail.push(h('div', { key: 'act', style: { display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
								h('button', {
									style: { ...subtle, padding: '2px 8px', fontSize: '11px' },
									onClick: () => copy(`dsh plugin --profile ${data.profile?.name ?? '<profile>'} add ${plugin.name}@${plugin.latest ?? 'latest'}`, `i-${plugin.name}`),
								}, copied === `i-${plugin.name}` ? t('copied') : t('copy_install')),
								h('a', {
									href: `https://www.npmjs.com/package/${plugin.name}`,
									target: '_blank',
									rel: 'noreferrer',
									style: { ...subtle, padding: '2px 8px', fontSize: '11px', textDecoration: 'none', display: 'inline-block' },
								}, t('npm_page'))))
							return h('div', { key: plugin.name, style: { borderTop: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))' } },
								h('button', {
									onClick: () => toggle(plugin.name),
									'aria-expanded': open,
									...interactive({
										font: 'inherit', width: '100%', textAlign: 'left', cursor: 'pointer',
										background: 'transparent', border: 'none', color: 'inherit',
										display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'baseline',
										padding: '6px 0',
									}),
								},
									h('span', { style: { fontSize: '12px', wordBreak: 'break-all' } }, plugin.name),
									h('span', { style: { ...muted, ...mono, whiteSpace: 'nowrap' } }, plugin.installed ?? '—'),
									h('span', { style: { whiteSpace: 'nowrap' } }, gaBadge(rowBadge[0], rowBadge[1], open ? t('collapse') : t('expand')))),
								open ? h('div', { style: { padding: '0 0 8px 2px' } }, ...detail) : null)
						}),
					])))
			}

			// ── health & usage ──────────────────────────────────────────────
			if (data !== null && data.health !== undefined) {
				section('status', h('div', { key: 'health', style: card },
					h('div', { style: label }, t('health_title')),
					h('div', { style: { fontSize: '12px', marginBottom: '6px' } },
						tf('health_score', { score: data.health.score, grade: data.health.grade })),
					(data.health.deductions ?? []).length === 0
						? h('div', { style: muted }, t('health_clean'))
						: h('div', null, ...(data.health.deductions ?? []).map(item => h('div', { key: item.code, style: { ...muted, padding: '2px 0' } },
							`−${item.points} · ${item.detail}`))),
					h('div', { style: { marginTop: '8px' } },
						h('button', {
							style: { ...subtle, padding: '2px 8px', fontSize: '11px' },
							onClick: async () => {
								try {
									const response = await fetch(`${STATUS_URL}?diagnostics=1`)
									const payload = await response.json()
									copy(String(payload.markdown ?? ''), 'diagnostics')
								} catch { /* leave the button quiet */ }
							},
						}, copied === 'diagnostics' ? t('copied') : t('diag_copy'))),
					usage === null
						? null
						: usage.ok !== true
							? h('div', { style: { ...muted, marginTop: '6px' } }, tf('usage_unavailable', { reason: usage.reason ?? 'unknown' }))
							: h('div', { style: { ...muted, marginTop: '6px' } },
								h('div', null, tf('usage_line', { sessions: usage.sessions ?? 0, calls: usage.toolCalls ?? 0 })),
								h('div', null, tf('usage_skills', { list: (usage.skills ?? []).slice(0, 6).map(item => `${item.name}×${item.count}`).join(', ') || '—' })))))
			}

			// ── skills ─────────────────────────────────────────────────────
			if (data !== null) {
				const details = (data.skillDetails ?? []).filter(item => item.description !== '')
				const matching = details.filter(item => skillQuery === '' ||
					item.name.toLowerCase().includes(skillQuery.toLowerCase()) ||
					item.description.toLowerCase().includes(skillQuery.toLowerCase()))
				const shown = showAllSkills || skillQuery !== '' ? matching : matching.slice(0, 6)
				const skillRow = item => h('div', {
					key: item.name,
					style: { padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))' },
				},
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
						h('span', { style: { ...mono, fontSize: '11.5px' } }, item.name),
						h('button', {
							style: { ...subtle, padding: '1px 8px', fontSize: '10.5px', marginInlineStart: 'auto' },
							onClick: () => {
								const seeded = seedComposer(tf('skills_prompt', { name: item.name }))
								if (!seeded) copy(tf('skills_prompt', { name: item.name }), `skill-${item.name}`)
							},
						}, copied === `skill-${item.name}` ? t('copied') : t('skills_try'))),
					h('div', { style: { ...muted, marginTop: '2px' } }, item.description))
				section('skills', h('div', { key: 'skills', style: card },
					h('div', { style: label }, tf('skills_title', { n: data.skills.length })),
					h('input', {
						value: skillQuery,
						onChange: event => setSkillQuery(event.target.value),
						onKeyDown: event => {
							if (event.key === 'Escape') setSkillQuery('')
						},
						placeholder: t('skills_search'),
						'aria-label': t('skills_search'),
						style: {
							width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: '12px',
							padding: '4px 8px', borderRadius: '8px', marginBottom: '4px',
							background: 'transparent', color: 'inherit',
							border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))',
						},
					}),
					details.length === 0
						? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
							...data.skills.map(name => h('span', {
								key: name,
								style: { ...mono, padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))' },
							}, name)))
						: h('div', null,
							...shown.map(skillRow),
							shown.length === 0 ? h('div', { style: { ...muted, padding: '6px 0' } }, t('empty_list')) : null,
							matching.length > 6
								? h('button', {
									style: { ...subtle, padding: '2px 8px', fontSize: '11px', marginTop: '6px' },
									onClick: () => setShowAllSkills(!showAllSkills),
								}, showAllSkills ? t('skills_show_less') : tf('skills_show_all', { n: matching.length }))
								: null)))
			}

			// ── prerequisites (informational) ───────────────────────────────
			const informational = prerequisites.filter(item => item.state !== 'missing')
			if (informational.length > 0) {
				section('plugins', h('div', { key: 'prereq', style: card },
					h('div', { style: label }, t('prereq_title')),
					...informational.map(item => h('div', { key: `${item.plugin}-${item.state}`, style: row },
						h('div', null,
							h('div', { style: { fontSize: '12px' } }, item.plugin),
							h('div', { style: { ...muted } }, GA_LANG === 'en' ? (item.needsEn ?? item.needs) : item.needs)),
						h('div', { style: { ...muted, textAlign: 'right' } }, item.state === 'found' ? t('ready') : t('check_yourself')),
						null))))
			}

			const TAB_LABEL = { status: t('tab_status'), plugins: t('tab_plugins'), skills: t('tab_skills'), settings: t('tab_settings') }
			const TAB_DEFS = [['status', 'tab_status'], ['plugins', 'tab_plugins'], ['skills', 'tab_skills'], ['settings', 'tab_settings']]
			const tabBar = data === null
				? null
				: h('div', {
					role: 'tablist',
					'aria-label': PRODUCT_NAME,
					style: { display: 'flex', gap: '4px', marginBottom: '10px', borderBottom: '1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.2))', paddingBottom: '6px' },
					onKeyDown: event => {
						if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
						const index = TAB_DEFS.findIndex(([key]) => key === tab)
						const step = event.key === 'ArrowRight' ? 1 : -1
						const next = (index + step + TAB_DEFS.length) % TAB_DEFS.length
						setTab(TAB_DEFS[next][0])
					},
				},
					...TAB_DEFS.map(([key, labelKey]) => h('button', {
						key,
						role: 'tab',
						'aria-selected': tab === key,
						...interactive({ ...chip(tab === key), padding: '3px 12px' }),
						onClick: () => setTab(key),
					}, t(labelKey))))

			return h('div', { style: { padding: '4px 2px 24px' } },
				...children,
				tabBar,
				flash === 'saved' ? h('div', { key: 'flash', role: 'status', 'aria-live': 'polite', style: { ...muted, marginBottom: '6px' } }, t('quiet_saved')) : null,
				data === null ? null : h('div', { role: 'tabpanel', 'aria-label': TAB_LABEL[tab] }, ...(tabs[tab] ?? [])))
		}

		// ─────────────────────────────────────────────────────────────────────
		// 4. Plugin entry
		// ─────────────────────────────────────────────────────────────────────


		/**
		 * Sidebar update dot (A3). The slot renders it next to the sidebar toggle
		 * when the sidebar is wide; it disappears during the quiet window so the
		 * bundle never nags at a time the user chose.
		 */
		function GAUpdateBadge({ hidden }) {
			const [state, setState] = React.useState(null)
			React.useEffect(() => {
				let live = true
				const read = () => {
					gaStatusPromise = null
					// Through gaStatusOnce so the tab-title marker is updated too.
					gaStatusOnce().then(payload => { if (live && payload !== null) setState(payload) })
				}
				read()
				window.addEventListener(GA_STATUS_EVENT, read)
				return () => { live = false; window.removeEventListener(GA_STATUS_EVENT, read) }
			}, [])
			// The slot only renders on the collapsed rail and passes no props, so
			// there is no `wide` to test; `hidden` is honoured when the platform sets it.
			if (hidden === true || state === null) return null
			if (state.settings?.quietNow === true) return null
			const update = state.updateAvailable === true
			const attention = (state.curated ?? []).filter(plugin => plugin.installed === undefined || plugin.alsoDirect === true).length +
				(state.prerequisites ?? []).filter(item => item.state === 'missing').length
			if (!update && attention === 0) return null
			const label = update ? `${PRODUCT_NAME}: ${tf('badge_update_title', { v: state.latest })}` : `${PRODUCT_NAME}: ${tf('badge_attention_title', { n: attention })}`
			return h('span', {
				title: label,
				'aria-label': label,
				'data-ga-badge': update ? 'update' : 'attention',
				style: {
					display: 'inline-block',
					width: '6px',
					height: '6px',
					borderRadius: '999px',
					marginInlineStart: '6px',
					background: update
						? 'var(--dsw-alias-state-warn-primary,#B45309)'
						: 'var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))',
				},
			})
		}

		function apply(ctx) {
			gaCtx = ctx
			// D3: the app knows its locale; use it when present (fallback: browser).
			// `locale` is not in our inject list, so reading `ctx.locale` can throw —
			// that must not take the whole client half down (it did once).
			try {
				// S5: `locale` is not in the inject list; `get()` actually resolves the
				// service when it exists, where `ctx.locale` would stay undefined.
				adoptAppLanguage(ctx.get?.('locale') ?? ctx.locale)
			} catch { /* fall back to the browser language */ }

			// D1: stored accent, applied as soon as the status arrives.
			const overrideAccent = applyAccent
			fetch(`${STATUS_URL}?plugins=1`, { headers: { accept: 'application/json' } })
				.then(response => (response.ok ? response.json() : null))
				.then(payload => {
					const accent = payload?.settings?.accent
					if (typeof accent === 'string' && ACCENT_COLORS[accent] !== undefined) overrideAccent(ACCENT_COLORS[accent])
				})
				.catch(() => { /* the default accent stays */ })

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
			ctx.effect(() => {
				overrideAccent(BRAND_COLOR)
				// S13: dispose the layer that is installed at unload time, not the one
				// created here (the user may have switched accents since).
				return () => {
					accentDisposer?.()
					accentDisposer = null
				}
			}, 'general-agentics: theme tokens')

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
			// Priority 1, not -1: if the desktop app brings its own update indicator,
			// that one should win (it knows about app updates); ours appears only
			// where no platform indicator exists.
			// The desktop app registers its own occupant in this single slot (fed by
			// `globalThis.dshDesktop`), and a single slot holds one entry: on the
			// desktop we step aside rather than replace the app-update indicator.
			// Everywhere else the bundle's own status is the only thing to show.
			if (globalThis.dshDesktop === undefined) {
				ctx.slots.inject('sidebar.toggle.badge', () =>
					ctx.slots.register({ name: 'sidebar.toggle.badge', priority: -1 }, GAUpdateBadge))
			}

			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register({ name: 'sidebar.footer.action', id: 'general-agentics-status', order: -1 }, GASidebarStatus))

			ctx.slots.inject('plugins.detail.badge', () =>
				ctx.slots.register({ name: 'plugins.detail.badge', priority: -1 }, GAPluginBadge))

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
