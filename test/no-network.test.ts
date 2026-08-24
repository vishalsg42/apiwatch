import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.js'

/**
 * apiwatch analyses code that makes HTTP calls; it must never make one itself. That claim is worth
 * enforcing rather than asserting, because it is the claim a supply-chain scanner is really asking
 * about, and because a dependency could smuggle a network import in without anyone noticing.
 *
 * It is asserted as a CAPABILITY, not as the absence of a URL-shaped string. Two reasons. A URL
 * literal proves nothing either way: `fetch(scheme + '://' + host)` contains no such string and is
 * still a network call, while `see https://github.com/...` in a help message is a string and is
 * not. And forbidding URL strings would forbid a legitimate future docs link, creating pressure to
 * obfuscate one, which is exactly the shape this project refuses to adopt for the scanner's
 * benefit.
 *
 * Run against the PACKED tarball, not the working dist/, so it covers the build, the `files` key,
 * and anything that exists only in what users actually install.
 */
const NETWORK_MODULES = [
  'http',
  'https',
  'net',
  'tls',
  'dgram',
  'dns',
  'child_process',
  'worker_threads',
]

// Comments must be stripped before scanning. apiwatch's own doc comments quote import statements
// as examples (`import fetch from 'node-fetch'`, `const request = require('request')`), and a
// scanner that reads them reports imports the bundle does not have. This was not hypothetical: the
// check passed under the previous bundler only because that bundler stripped comments, so the
// weakness was invisible until the build changed. A comment can also name a NETWORK module, which
// would have produced a false alarm in the other direction.
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

// Matches `require('net')`, `from 'node:net'`, `import('node:net')`. Bare and node:-prefixed.
// The character class allows hyphens, dots and @scopes: a first pass used [a-z_/]+ and silently
// missed `from "ts-morph"` entirely, which would equally have missed a dependency named something
// like `fast-net`. A capability check with a blind spot is worse than none.
const importsOf = (src: string) =>
  new Set(
    [
      ...stripComments(src).matchAll(
        /(?:require\(|from\s*|import\()\s*['"](node:)?(@?[a-z0-9._/-]+)['"]/g,
      ),
    ].map((m) => m[2]),
  )

let bundle: string | undefined

beforeAll(() => {
  const packDir = mkdtempSync(join(tmpdir(), 'apiwatch-net-'))
  execFileSync('npm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })
  const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')
  execFileSync('tar', ['-xzf', join(packDir, tarball), '-C', packDir])
  const cli = join(packDir, 'package/dist/cli.js')
  // throw, never skip. A capability check that quietly skips when the artifact is missing proves
  // nothing on the one machine where it matters, and reads green while covering nothing.
  if (!existsSync(cli)) throw new Error(`packed tarball has no dist/cli.js at ${cli}`)
  bundle = readFileSync(cli, 'utf8')
}, 120_000)

describe('the published package cannot reach the network', () => {
  it('imports no networking or process-spawning module', () => {
    const found = [...importsOf(bundle as string)].filter((m) => NETWORK_MODULES.includes(m))
    expect(found).toEqual([])
  })

  it('imports only the modules a static analyser needs', () => {
    // An allowlist rather than a denylist: a module nobody thought to forbid is the one that
    // would carry the capability in. Anything new here is a deliberate decision, not an oversight.
    const allowed = new Set(['fs', 'fs/promises', 'path', 'url', 'crypto', 'os', 'ts-morph'])
    // ts-morph is a runtime dependency rather than bundled, so this covers apiwatch's own code.
    // Its tree was checked by hand at 0.3.6: neither @ts-morph/common nor code-block-writer
    // requires a networking module. That is a point-in-time fact, not something this asserts.
    const unexpected = [...importsOf(bundle as string)].filter((m) => !allowed.has(m))
    expect(unexpected).toEqual([])
  })

  it('ignores a module named only in a comment, but not a real one', () => {
    // Both halves matter. Reading comments causes false alarms; skipping real code causes misses.
    const commented = `/** see \`import { request } from 'node:https'\` */\nconst x = 1`
    expect([...importsOf(commented)]).toEqual([])
    const real = `import { request } from 'node:https'\nconst x = 1`
    expect([...importsOf(real)]).toEqual(['https'])
  })

  it('fails when a network import is present, which is what makes the check meaningful', () => {
    // The bundle is already clean, so the two assertions above pass without any fix and cannot
    // demonstrate themselves. Run the same predicate over a poisoned copy to show it bites.
    const poisoned = `import { request } from 'node:https'\n${bundle}`
    const found = [...importsOf(poisoned)].filter((m) => NETWORK_MODULES.includes(m))
    expect(found).toEqual(['https'])
  })
})
