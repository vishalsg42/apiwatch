import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'
import { renderTty } from '../src/report/tty.js'
import { repoRoot } from './helpers.js'

const fenced = (md: string, startsWith: string) => {
  const m = md.match(new RegExp('```\\n(' + startsWith + '[\\s\\S]*?)```'))
  if (!m) throw new Error(`no fenced block starting with ${startsWith}`)
  return m[1].replace(/^\n+|\n+$/g, '')
}

// The README's flagship block once declared 15 findings while showing 7, under a sentence
// promising verbatim output. It was truncated by a `sed -n '1,16p'` and then "verified" by
// checking every line IN the block appeared in real output, which any prefix satisfies.
// These tests exist so that cannot happen silently again.
describe('documented output blocks', () => {
  it('the example README block is byte-identical to live output', async () => {
    const root = join(repoRoot, 'examples/vulnerable-service')
    const { model } = await runAudit({ root })
    const live = renderTty(model).replace(/^\n+|\n+$/g, '')
    const documented = fenced(readFileSync(join(root, 'README.md'), 'utf8'), '  analysed 5 of 5')
    expect(documented).toBe(live)
  })

  // Outline cannot be cloned in CI, so guard the block structurally instead. Both of these
  // would have failed on the shipped README.
  // The FULL block now lives in the case study; the README carries an abridged one. Both are
  // checked, and differently: the full block must account for every finding, and the abridged one
  // must be a genuine PREFIX of it. An excerpt that quietly edited a line would pass a
  // "does it look right" check and fail this one.
  const outlineBlock = () =>
    fenced(readFileSync(join(repoRoot, 'docs/case-study-outline.md'), 'utf8'), '  analysed 2144')

  it('the Outline block shows every finding its own summary counts', () => {
    const lines = outlineBlock()
      .split('\n')
      .filter((l) => l.trim())
    const summary = lines
      .map((l) => /^\s*[✖⚠ℹ]\s+\S+\s+(\d+)/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .reduce((n, m) => n + Number(m[1]), 0)
    const detail = lines.filter((l) => /\.(ts|tsx|js):\d+/.test(l)).length
    expect(summary).toBeGreaterThan(0)
    expect(detail).toBe(summary)
  })

  it('the Outline block ends with the unresolved-hosts footer, so it is not truncated', () => {
    const lines = outlineBlock()
      .split('\n')
      .filter((l) => l.trim())
    expect(lines[lines.length - 1]).toMatch(/hosts unresolved for \d+ call sites/)
  })

  it('the README excerpt is a real prefix of the full block, not a doctored one', () => {
    const full = outlineBlock()
      .split('\n')
      .filter((l) => l.trim())
    const excerpt = fenced(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '  analysed 2144')
      .split('\n')
      .filter((l) => l.trim() && l.trim() !== '…')
    expect(excerpt.length).toBeGreaterThan(3)
    expect(excerpt.length).toBeLessThan(full.length) // it really is an excerpt
    for (const [i, line] of excerpt.entries()) expect(line).toBe(full[i])
  })
})
