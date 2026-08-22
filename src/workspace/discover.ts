import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Workspace } from '../model.js'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  '.aws-sam',
  'vendor',
  'test',
  'tests',
  '__tests__',
  'e2e',
])

// Directories whose contents are never the deployed application: sample code written to be
// minimal, benchmarks, and documentation. A missing timeout in any of them cannot page
// anyone, so reporting it is a false alarm that costs the report its credibility. Measured
// across six public repos, 10% of all findings sat outside shipped code, and in libraries it
// reached 60%.
//
// `scripts`, `tools` and `bin` are deliberately NOT here. A release script that fetches with
// no timeout really does hang CI, and enough projects put runtime code under `scripts/` that
// excluding it would trade a visible false positive for an invisible false negative, which is
// the worse failure. Dot-directories (`.github`, `.next`) are already skipped by the walker.
//
// This is a directory-NAME heuristic and therefore partial: Uptime Kuma keeps sample code in
// `extra/push-examples/`, whose segment is `push-examples`, so no exact-segment rule catches
// it. The excluded count is reported rather than dropped silently, so what it missed (and
// what it took) stays checkable.
const NON_SHIPPING_DIRS = new Set([
  'example',
  'examples',
  'sample',
  'samples',
  'demo',
  'demos',
  'playground',
  'playgrounds',
  'benchmark',
  'benchmarks',
  'bench',
  'perf',
  'fixture',
  'fixtures',
  '__fixtures__',
  '__mocks__',
  'mocks',
  'cypress',
  'doc',
  'docs',
])

const EXT = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts)$/
const SKIP_FILE = /(\.d\.ts$|\.min\.js$|\.test\.|\.spec\.)/
const posix = (p: string) => p.split(sep).join('/')

export type DiscoverOptions = {
  /** Audit sample code, benchmarks and docs alongside shipped code. Off by default. */
  includeNonShipping?: boolean
}

export async function discoverWorkspace(
  root: string,
  opts: DiscoverOptions = {},
): Promise<Workspace> {
  const sourceFiles: string[] = [],
    nonShipping: string[] = [],
    packageDirs: string[] = []
  const dependencies: Record<string, string> = {}

  // `outside` latches on: every descendant of a non-shipping directory is non-shipping too.
  async function walk(dir: string, outside: boolean) {
    let entries: Dirent[] | undefined
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
        // Descend into non-shipping directories rather than pruning them, so the files they
        // hold can be counted and reported instead of vanishing from the totals.
        await walk(p, outside || NON_SHIPPING_DIRS.has(e.name.toLowerCase()))
      } else if (e.name === 'package.json') {
        packageDirs.push(posix(dir))
        try {
          const pkg = JSON.parse(await readFile(p, 'utf8'))
          Object.assign(dependencies, pkg.devDependencies ?? {}, pkg.dependencies ?? {})
        } catch {
          /* an unreadable package.json is not fatal */
        }
      } else if (EXT.test(e.name) && !SKIP_FILE.test(e.name)) {
        ;(outside ? nonShipping : sourceFiles).push(posix(p))
      }
    }
  }
  await walk(root, false)

  const included = opts.includeNonShipping ? [...sourceFiles, ...nonShipping] : sourceFiles
  return {
    root: posix(root),
    sourceFiles: included.sort(),
    packageDirs,
    dependencies,
    nonShippingFilesExcluded: opts.includeNonShipping ? 0 : nonShipping.length,
  }
}
