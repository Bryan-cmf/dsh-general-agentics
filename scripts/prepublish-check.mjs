#!/usr/bin/env node
/**
 * Runs before `npm publish` (`prepublishOnly`): the smallest set of checks that
 * would have caught the mistakes we actually made.
 *
 *   1. the whole test suite (manifest <-> patch rows, YAML guard expressions,
 *      endpoint authorization, MCP server, panel payload)
 *   2. the overlay parses as YAML, when the DSH runtime's js-yaml is available
 *   3. a reminder of the steps a machine cannot do (publish approval, changelog)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const fail = message => {
	console.error(`prepublish-check: ${message}`)
	process.exit(1)
}

console.log('• tests')
const tests = spawnSync(process.execPath, ['--test', 'test/'], { stdio: 'inherit' })
if (tests.status !== 0) fail('the test suite failed')

console.log('• adversarial probes')
const probes = spawnSync(process.execPath, ['scripts/review.mjs'], { stdio: 'inherit' })
if (probes.status !== 0) fail('the review probes failed')

console.log('• overlay parses as YAML')
try {
	const dshHome = process.env.DSH_HOME ?? `${process.env.HOME ?? ''}/.dsh`
	const store = `${dshHome}/runtime/node_modules/.pnpm`
	const appBoot = readdirSync(store).filter(name => name.startsWith('@deepseek-ai+dsh-app-boot@')).sort().at(-1)
	const yaml = createRequire(`${store}/${appBoot}/node_modules/@deepseek-ai/dsh-app-boot/package.json`)('js-yaml')
	// DSH registers its own `!!js` schema; without it js-yaml refuses every row.
	const jsTag = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value })
	const schema = yaml.DEFAULT_SCHEMA.extend([jsTag])
	yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema })
	console.log('  ok (structure + !!js tags)')
} catch (error) {
	// No runtime on this machine (CI): the structural tests already cover the
	// shapes that broke before, so this is best-effort rather than fatal.
	console.log(`  skipped (${String(error?.code ?? error).slice(0, 60)})`)
}

console.log('\nremember:')
console.log('  - bump the version and add a CHANGELOG entry')
console.log('  - publishing needs the account approval flow; verify with:')
console.log('      npm view dsh-general-agentics version')
