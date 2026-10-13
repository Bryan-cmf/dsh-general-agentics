/**
 * Regression tests for the bundled-skill provider (lib/index.js).
 *
 * Run with `node --test` (Node >= 20). Zero dependencies on purpose: this
 * package ships no install script and no runtime dependency, and its tests
 * must not add either.
 *
 * The frontmatter shapes below are not invented. They are the exact shapes
 * that a survey of 215 real skills on the maintainer's machine produced, and
 * 6 of them (2.8%) are rejected by the platform's own kebab-case name rule.
 * Under the previous behaviour collectCandidates() threw on those, which
 * escapes apply(), fails the Loader entry, and can stop the whole app
 * (docs/ops-lessons.md rule 5). These tests pin the warn-and-skip contract
 * that dsh-skill-filesystem itself implements (lib/index.js:682, :686).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { __test } from '../lib/index.js'

const { parseSkillFile, unquoteScalar, collectCandidates, SKILL_NAME_RE } = __test

/** Build a throwaway skills/ tree: { dirName: frontmatter-and-body | null }. */
function makeTree(entries) {
	const root = mkdtempSync(join(tmpdir(), 'ga-skills-'))
	for (const [dir, body] of Object.entries(entries)) {
		if (body === null) {
			// A plain file where a skill directory might be (THIRD-PARTY.md).
			writeFileSync(join(root, dir), 'not a skill\n')
			continue
		}
		mkdirSync(join(root, dir), { recursive: true })
		writeFileSync(join(root, dir, 'SKILL.md'), body)
	}
	return root
}

/** Collect warnings emitted by collectCandidates instead of throwing. */
function collect(root) {
	const warnings = []
	const candidates = collectCandidates(root, (message) => warnings.push(message))
	return { candidates, warnings }
}

const skill = (frontmatter, body = '# Body\n') => `---\n${frontmatter}\n---\n\n${body}`

// ─────────────────────────────────────────────────────────────────────────
// parseSkillFile — the YAML subset the skill ecosystem actually uses
// ─────────────────────────────────────────────────────────────────────────

test('parses a plain single-line scalar', () => {
	const { meta, content } = parseSkillFile(skill('name: my-skill\ndescription: Does a thing'), 'x')
	assert.equal(meta.name, 'my-skill')
	assert.equal(meta.description, 'Does a thing')
	assert.equal(content, '# Body')
})

test('strips one pair of matching surrounding quotes', () => {
	assert.equal(unquoteScalar('"You MUST use this"'), 'You MUST use this')
	assert.equal(unquoteScalar("'single'"), 'single')
	// A quote inside the value must survive; only a matching pair is stripped.
	assert.equal(unquoteScalar('say "hi" now'), 'say "hi" now')
	assert.equal(unquoteScalar('"mismatched\''), '"mismatched\'')
})

test('parses a literal block scalar (|)', () => {
	const raw = skill('name: my-skill\ndescription: |\n  line one\n  line two')
	assert.equal(parseSkillFile(raw, 'x').meta.description, 'line one\nline two')
})

test('parses a folded block scalar (>)', () => {
	const raw = skill('name: my-skill\ndescription: >\n  line one\n  line two')
	assert.equal(parseSkillFile(raw, 'x').meta.description, 'line one line two')
})

test('a column-0 key ends a block scalar', () => {
	const raw = skill('name: my-skill\ndescription: |\n  wrapped text\nhomepage: https://example.com')
	const { meta } = parseSkillFile(raw, 'x')
	assert.equal(meta.description, 'wrapped text')
	assert.equal(meta.homepage, 'https://example.com')
})

test('tolerates list-valued and empty-valued fields it does not use', () => {
	const raw = skill('name: my-skill\ndescription: ok\ntriggers:\n  - "one"\n  - two\nmetadata:')
	const { meta } = parseSkillFile(raw, 'x')
	assert.equal(meta.name, 'my-skill')
	assert.equal(meta.description, 'ok')
	assert.equal(meta.triggers, undefined, 'list header carries no scalar value')
})

test('skips comment lines inside frontmatter', () => {
	const raw = skill('# a comment\nname: my-skill\ndescription: ok')
	assert.equal(parseSkillFile(raw, 'x').meta.name, 'my-skill')
})

test('rejects a file with no frontmatter', () => {
	assert.throws(() => parseSkillFile('# just a heading\n', 'x'), /no YAML frontmatter/u)
})

test('rejects a missing or non-kebab-case name', () => {
	assert.throws(() => parseSkillFile(skill('description: no name'), 'x'), /kebab-case name/u)
	assert.throws(() => parseSkillFile(skill('name: My Skill\ndescription: x'), 'x'), /kebab-case name/u)
})

test('rejects a missing description', () => {
	assert.throws(() => parseSkillFile(skill('name: my-skill'), 'x'), /no description/u)
})

test('SKILL_NAME_RE accepts the grammar the skill system enforces', () => {
	for (const good of ['a', 'a-b', 'html-ppt-xhs-post', 'qwencloud-image-generation', 'x2-y3']) {
		assert.ok(SKILL_NAME_RE.test(good), `${good} should be valid`)
	}
	for (const bad of ['Deploy', 'UI/UX', 'RedBookSkills', '交叉驗證搜索', 'Deploy Vercel', '-lead', 'a--', '']) {
		assert.ok(!SKILL_NAME_RE.test(bad), `${bad} should be invalid`)
	}
})

// ─────────────────────────────────────────────────────────────────────────
// collectCandidates — one bad skill must never take the bundle down
// ─────────────────────────────────────────────────────────────────────────

test('collects valid skills and ignores non-skill entries', () => {
	const root = makeTree({
		'good-skill': skill('name: good-skill\ndescription: Works'),
		'THIRD-PARTY.md': null, // a plain file among the skill directories
	})
	// A directory with no SKILL.md (assets, an upstream LICENSE folder, …)
	// must be skipped silently: it is not a rejected skill, it is not a skill.
	mkdirSync(join(root, 'superpowers'), { recursive: true })
	writeFileSync(join(root, 'superpowers', 'LICENSE'), 'MIT\n')
	const { candidates, warnings } = collect(root)
	assert.deepEqual(candidates.map(c => c.name), ['good-skill'])
	assert.deepEqual(warnings, [], 'non-skill entries are not warnings')
	rmSync(root, { recursive: true, force: true })
})

test('warns and skips a skill whose name is not kebab-case, without throwing', () => {
	// The five real shapes found in the wild: capitalised, non-ASCII, spaces,
	// slashes, camel case. The platform rejects all five the same way.
	const root = makeTree({
		Deploy: skill('name: Deploy\ndescription: ship it'),
		'cross-validated-search': skill('name: 交叉驗證搜索\ndescription: search'),
		'deploy-vercel': skill('name: Deploy Vercel\ndescription: vercel'),
		'impeccable-uxui': skill('name: UI/UX\ndescription: design'),
		redbook: skill('name: RedBookSkills\ndescription: xhs'),
		'good-skill': skill('name: good-skill\ndescription: Works'),
	})
	const { candidates, warnings } = collect(root)
	assert.deepEqual(candidates.map(c => c.name), ['good-skill'], 'only the conforming skill survives')
	assert.equal(warnings.length, 5, 'one warning per rejected skill')
	assert.ok(warnings.every(w => w.includes('ignored')), 'warnings say the skill was ignored')
	rmSync(root, { recursive: true, force: true })
})

test('keeps a skill whose frontmatter name differs from its directory', () => {
	// Real case: html-ppt-presenter-mode-reveal/ declares html-ppt-presenter-mode.
	// The platform keys skills by frontmatter name and does not require a
	// match, so neither do we — otherwise a vendored copy would behave
	// differently from the user-level copy of the same skill.
	const root = makeTree({
		'html-ppt-presenter-mode-reveal': skill('name: html-ppt-presenter-mode\ndescription: deck'),
	})
	const { candidates, warnings } = collect(root)
	assert.deepEqual(candidates.map(c => c.name), ['html-ppt-presenter-mode'])
	assert.equal(warnings.length, 1)
	assert.match(warnings[0], /differs from its directory/u)
	assert.equal(candidates[0].resourceBase.path, join(root, 'html-ppt-presenter-mode-reveal'),
		'resources still resolve against the real directory')
	rmSync(root, { recursive: true, force: true })
})

test('a skill that throws mid-scan does not stop the rest', () => {
	const root = makeTree({
		'a-broken': skill('name: Broken Name\ndescription: x'),
		'b-good': skill('name: b-good\ndescription: Works'),
		'c-also-good': skill('name: c-also-good\ndescription: Works'),
	})
	const { candidates } = collect(root)
	assert.deepEqual(candidates.map(c => c.name), ['b-good', 'c-also-good'])
	rmSync(root, { recursive: true, force: true })
})

test('every candidate carries the fields the skill registry needs', () => {
	const root = makeTree({ 'good-skill': skill('name: good-skill\ndescription: Works') })
	const { candidates } = collect(root)
	const c = candidates[0]
	assert.equal(c.provider, 'general-agentics')
	assert.equal(c.source, 'bundled')
	assert.equal(c.rank, 600, 'bundled rank: a user-level skill of the same name must win')
	assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true })
	assert.equal(c.resourceBase.kind, 'directory')
	assert.equal(c.locator, join(root, 'good-skill', 'SKILL.md'))
	assert.equal(c._content, '# Body')
	rmSync(root, { recursive: true, force: true })
})
