import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keyOf, readBaseline, writeBaseline } from '../src/baseline.js'
import type { Finding } from '../src/model.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: 'no-timeout',
  severity: 'error',
  fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  callSiteId: 'x',
  file: 'src/svc.ts',
  line: 4,
  message: 'no deadline',
  evidence: 'axios.get()',
  ...over,
})

const tmp = () => join(mkdtempSync(join(tmpdir(), 'apiwatch-bl-')), 'baseline.json')

const opts = { root: '.', includeNonShipping: false }

describe('baseline file', () => {
  it('keys on rule AND fingerprint, never fingerprint alone', () => {
    const a = finding({ rule: 'no-timeout' })
    const b = finding({ rule: 'no-retry', severity: 'warn' })
    expect(keyOf(a)).not.toBe(keyOf(b))
    expect(keyOf(a)).toContain('no-timeout')
  })

  it('writes byte-identical output for the same findings', () => {
    const p1 = tmp()
    const p2 = tmp()
    const fs = [finding(), finding({ rule: 'no-retry', severity: 'warn' })]
    writeBaseline(p1, fs, '0.3.0', opts)
    writeBaseline(p2, [...fs].reverse(), '0.3.0', opts)
    expect(readFileSync(p1, 'utf8')).toBe(readFileSync(p2, 'utf8'))
  })

  it('counts duplicates rather than storing them twice', () => {
    const p = tmp()
    writeBaseline(p, [finding(), finding()], '0.3.0', opts)
    const b = readBaseline(p)
    expect(b.accepted).toHaveLength(1)
    expect(b.accepted[0].count).toBe(2)
  })

  it('puts one entry per line so branches can auto-merge', () => {
    const p = tmp()
    writeBaseline(
      p,
      [finding(), finding({ fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbb' })],
      '0.3.0',
      opts,
    )
    const entryLines = readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.trim().startsWith('{"fp"'))
    expect(entryLines).toHaveLength(2)
  })

  it('rejects a malformed file rather than accepting nothing', () => {
    const p = tmp()
    writeFileSync(p, '{ not json')
    expect(() => readBaseline(p)).toThrow(/could not be parsed|malformed/i)
  })

  it('rejects a baseline from a different fingerprint version', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    raw.fingerprintVersion = 999
    writeFileSync(p, JSON.stringify(raw))
    expect(() => readBaseline(p)).toThrow(/fingerprintVersion/i)
  })

  // The message is the whole user experience of this error: it is thrown in CI, where nobody can
  // experiment. A real report had a workflow on a floating `apiwatch@0.3` range go red the moment
  // a fingerprintVersion bump published, with the message naming one command and not the order to
  // run it in. Naming `apiwatch baseline` alone is not enough, because regenerating accepts every
  // finding currently visible, including new error-severity ones, and prints only a count.
  it('tells you to review BEFORE regenerating, and to pin a version', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    raw.fingerprintVersion = 999
    writeFileSync(p, JSON.stringify(raw))
    let msg = ''
    try {
      readBaseline(p)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    // review first, without --baseline, or regeneration silently swallows new findings
    expect(msg).toMatch(/audit --fail-on error/)
    expect(msg).toMatch(/without --baseline|no --baseline/i)
    // then regenerate
    expect(msg).toMatch(/apiwatch baseline/)
    // and stop this recurring: a floating range upgrades you without asking
    expect(msg).toMatch(/pin/i)
    // the review step must come before the regenerate step, not merely be present
    expect(msg.indexOf('audit --fail-on error')).toBeLessThan(msg.indexOf('apiwatch baseline'))
  })

  // The caller resolves a relative --baseline to an absolute path before reading it, so echoing
  // that back handed a CI user a long absolute path instead of the short one they typed. Step 2
  // has to be paste-ready or the numbered list is decoration.
  it('echoes the path the user typed, not the resolved absolute one', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    raw.fingerprintVersion = 999
    writeFileSync(p, JSON.stringify(raw))
    const cwd = process.cwd()
    // realpathSync because macOS resolves the temp dir through a /private symlink: chdir to the
    // unresolved path leaves process.cwd() reporting the resolved one, relative() then yields a
    // ../.. escape, and the test fails for a reason that has nothing to do with the code.
    process.chdir(realpathSync(dirname(p)))
    try {
      // Exactly what the CLI does: resolve() the user's relative --baseline against the current
      // directory, then read it. Passing a relative path here instead would exercise a code path
      // the CLI never takes, and the assertion would hold with or without the fix.
      readBaseline(resolve(basename(p)))
      throw new Error('expected a mismatch')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      expect(msg).toContain(`--out ${basename(p)}`)
      expect(msg).not.toContain(dirname(p))
    } finally {
      process.chdir(cwd)
    }
  })

  it('rejects a baseline recorded against a different root', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', { root: 'packages/api', includeNonShipping: false })
    expect(() => readBaseline(p, { root: '.', includeNonShipping: false })).toThrow(/root/i)
  })

  it('stores an excerpt for review, and no line number', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const entry = readBaseline(p).accepted[0]
    expect(entry.excerpt).toBeTruthy()
    expect(entry).not.toHaveProperty('line')
  })
})
