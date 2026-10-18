/**
 * Panel settings that need to be understood by the host (and therefore by the
 * tests) rather than only by the browser: currently the quiet window, which
 * decides whether the sidebar badge may nag about an update.
 *
 * The window is expressed in whole hours and may wrap midnight (22 → 8).
 */

/** Named windows the panel offers; `null` means "never quiet". */
export const QUIET_PRESETS = {
	off: null,
	night: { from: 22, to: 8 },
	work: { from: 9, to: 18 },
}

/**
 * Parse a `from-to` string ("22-8") or a preset name ("night") into a window.
 * Anything unrecognised is treated as "off" rather than throwing.
 */
export function parseQuiet(raw) {
	if (raw === undefined || raw === null || raw === 'off' || raw === '') return null
	if (Object.prototype.hasOwnProperty.call(QUIET_PRESETS, raw)) return QUIET_PRESETS[raw]
	const match = /^(\d{1,2})-(\d{1,2})$/u.exec(String(raw))
	if (match === null) return null
	const from = Number(match[1])
	const to = Number(match[2])
	if (from > 23 || to > 23) return null
	return { from, to }
}

/** Accept either a normalized window or a stored string/preset. */
export function normalizeWindow(value) {
	if (value === null || value === undefined) return null
	if (typeof value === 'object') {
		const { from, to } = value
		const valid = hour => Number.isInteger(hour) && hour >= 0 && hour <= 23
		return valid(from) && valid(to) ? { from, to } : null
	}
	return parseQuiet(value)
}

/** True while `now` sits inside the window; wraps when from > to. */
export function quietHoursActive(window, now = new Date()) {
	if (window === null || window === undefined) return false
	const { from, to } = window
	if (!Number.isInteger(from) || !Number.isInteger(to)) return false
	const hour = now.getHours()
	if (from === to) return true
	return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

/** The default settings a profile has before the user touches anything. */
export function defaultSettings() {
	return { quietHours: null }
}
