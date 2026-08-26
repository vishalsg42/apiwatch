import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAudit } from '../src/cli/audit.js'

/**
 * A zero that the reader cannot explain.
 *
 * A client apiwatch cannot resolve is skipped in silence: the call reaches no counter, not the
 * call-site count, not the unresolved-host count, not the skipped-file count, and the file still
 * reports as analysed. So a repository whose client is selected by an expression reports a
 * confident zero that looks identical to a repository that makes no outbound calls. That is the
 * one limitation with no visible symptom at all. See #6.
 *
 * This does not resolve those clients. It makes the zero say so.
 *
 * The trigger is deliberately narrow. The same list on a run that DID find call sites is mostly
 * `http.Agent` used as a type or a base class: measured across two public repositories it names 6
 * files of which 1 is a genuine miss. At that precision it would train a reader to skip the line.
 * When the run found nothing at all, the alternative is not a quieter report but an unexplained
 * zero, and naming the candidates is strictly better than naming nothing.
 */
const audit = async (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'apiwatch-zero-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'package.json'), '{"name":"z","dependencies":{"axios":"^1.7.0"}}')
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, 'src', name), src)
  return runAudit({ root: dir })
}

/**
 * A client this analysis still cannot resolve. It is read out of a map, so WHICH client
 * `clients[name]` returns is a runtime fact and no syntactic rule can decide it.
 *
 * A ternary used to be the example here, and was stripe-node's shape. It resolves now, because
 * both arms are visible and can be required to agree. An element access is the part of #6 that
 * remains, and it is what this diagnostic exists to make visible.
 */
const EXPRESSION_CLIENT = [
  "import axios from 'axios'",
  'const clients: Record<string, typeof axios> = { primary: axios }',
  'declare const name: string',
  "export const f = () => clients[name].get('https://v.dev/a')",
].join('\n')

describe('an unexplained zero names the files it could not read', () => {
  it('reports the file when the run found no call sites at all', async () => {
    const { output } = await audit({ 'a.ts': EXPRESSION_CLIENT })
    expect(output).toContain('0 outbound call sites')
    expect(output).toContain('import an HTTP client but produced no call sites')
    expect(output).toContain('src/a.ts')
  })

  it('stays silent once anything resolved, where the same list is mostly noise', async () => {
    const { output } = await audit({
      'a.ts': EXPRESSION_CLIENT,
      'b.ts': [
        "import axios from 'axios'",
        "export const g = () => axios.get('https://v.dev/b')",
      ].join('\n'),
    })
    expect(output).toContain('1 outbound call sites')
    expect(output).not.toContain('produced no call sites')
  })

  it('stays silent when a repo genuinely makes no outbound calls', async () => {
    const { output } = await audit({ 'a.ts': 'export const add = (a: number, b: number) => a + b' })
    expect(output).toContain('0 outbound call sites')
    expect(output).not.toContain('produced no call sites')
  })

  /**
   * The global fetch is registered in every file that does not shadow it, so counting it would
   * name every file in the repository and say nothing.
   */
  it('does not treat the implicit global fetch as a client the file reached for', async () => {
    const { output } = await audit({ 'a.ts': 'export const add = (a: number) => a + 1' })
    expect(output).not.toContain('produced no call sites')
  })

  /**
   * A file that only CONSTRUCTS a client is named, and that is deliberate rather than a gap.
   * It imports a client and yields no call site, which is exactly what the line claims. Normally
   * something elsewhere calls the instance, the run has call sites and this never appears; the
   * only way to reach it is a repository where nothing called anything, and there a file holding
   * an unused client is a reasonable place to look.
   */
  it('names a file that builds a client nobody calls, since nothing called anything', async () => {
    const { output } = await audit({
      'a.ts': [
        "import axios from 'axios'",
        'export const api = axios.create({ timeout: 5000 })',
      ].join('\n'),
    })
    expect(output).toContain('0 outbound call sites')
    expect(output).toContain('produced no call sites')
  })

  /**
   * A BARE factory import is different and stays excluded: `create` builds a client and is not
   * one, so a file holding only that binding makes no request by design.
   */
  it('does not name a file whose only binding is a factory', async () => {
    const { output } = await audit({
      'a.ts': ["import { create } from 'axios'", 'export const mk = () => create'].join('\n'),
    })
    expect(output).toContain('0 outbound call sites')
    expect(output).not.toContain('produced no call sites')
  })

  it('is not part of the --json contract, which stays at schemaVersion 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiwatch-zero-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'package.json'), '{"name":"z"}')
    writeFileSync(join(dir, 'src', 'a.ts'), EXPRESSION_CLIENT)
    const { output, model } = await runAudit({ root: dir, json: true })
    expect(model.schemaVersion).toBe(2)
    expect(JSON.parse(output)).toEqual(model)
    expect(output).not.toContain('produced no call sites')
  })
})
