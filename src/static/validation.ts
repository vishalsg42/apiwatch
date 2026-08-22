import { type CallExpression, type PropertyAccessExpression, SyntaxKind } from 'ts-morph'
import { collectFileImports, collectImportedNames } from './imports.js'

const VALIDATOR_LIBS = ['zod', 'joi', '@hapi/joi', 'yup', 'ajv', 'class-validator']
const MEMBER_NAMES = new Set(['parse', 'safeParse', 'validate', 'validateSync', 'cast', 'assert'])
const FREE_NAMES = new Set(['validate', 'validateSync', 'validateOrReject', 'assert'])
// `JSON.parse`/`Date.parse` share the member name `parse` with zod's `.parse()` but are never
// schema validation; a receiver check, not a name check, is what actually excludes them.
const EXCLUDED_RECEIVERS = new Set(['JSON', 'Date'])

/**
 * Whether the response of an HTTP call is validated before use. Only a PROVABLE `false` may
 * produce a finding: every path that can't be followed syntactically returns `'unknown'`,
 * which keeps the `unvalidated-response` rule silent rather than wrong.
 *
 * Three things this deliberately gets right that a naive version doesn't:
 *
 * 1. The import check uses `collectFileImports`, not `sf.getImportDeclarations()` alone,
 *    because the latter returns `[]` for a CommonJS file (`const Joi = require('joi')`); that
 *    blind spot would turn a validated CJS call site into a false positive.
 *
 * 2. "no validator library imported in THIS file" only rules out a *direct* validator call in
 *    this file; it says nothing about whether the response value is handed off to a helper
 *    imported from elsewhere (e.g. `handle(await axios.get(...))` where `handle` lives in
 *    another module that may validate it). So the local-import check only gates the two "prove
 *    it's validated" branches; the escape-to-an-imported-function check always runs and can
 *    still downgrade the verdict to `'unknown'` even when this file imports no validator lib.
 *
 * 3. Whether the enclosing function validates is decided per call NODE (a member call's
 *    property name, a free call's identifier name), never by running a regex over the whole
 *    enclosing function's source text; that would also match a `.validate(`/`.parse(` sitting
 *    in a comment, a string, or an unrelated nested call (e.g. `JSON.parse`), the exact class of
 *    bug this project has already shipped and fixed twice for whole-body regexes.
 */
export function isResponseValidated(call: CallExpression): boolean | 'unknown' {
  const sf = call.getSourceFile()
  const imports = collectFileImports(sf)
  const hasValidatorLib = imports.some((i) => VALIDATOR_LIBS.includes(i))

  const fn = call.getFirstAncestor(
    (a) =>
      a.getKind() === SyntaxKind.FunctionDeclaration ||
      a.getKind() === SyntaxKind.ArrowFunction ||
      a.getKind() === SyntaxKind.MethodDeclaration,
  )
  if (!fn) return 'unknown'

  const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression)

  const hasMemberValidatorCall = calls.some((c) => {
    const e = c.getExpression()
    if (e.getKind() !== SyntaxKind.PropertyAccessExpression) return false
    const pae = e as PropertyAccessExpression
    if (EXCLUDED_RECEIVERS.has(pae.getExpression().getText())) return false
    return MEMBER_NAMES.has(pae.getName())
  })
  if (hasValidatorLib && hasMemberValidatorCall) return true

  const hasFreeValidatorCall = calls.some((c) => {
    const e = c.getExpression()
    return e.getKind() === SyntaxKind.Identifier && FREE_NAMES.has(e.getText())
  })
  if (hasValidatorLib && hasFreeValidatorCall) return true

  // Must see CJS `const { handle } = require('./other')` bindings too, not just ESM named
  // imports; using getImportDeclarations() alone here (while the hasValidatorLib check above
  // correctly used collectFileImports) meant this escape check was silently blind for CJS: a
  // CJS file handing its response to an imported function returned a false `false` (proven
  // unvalidated) instead of 'unknown', firing unvalidated-response on a call this analysis
  // simply can't see far enough to judge.
  const importedNames = collectImportedNames(sf)
  const escapes = calls.some((c) => {
    const e = c.getExpression()
    return e.getKind() === SyntaxKind.Identifier && importedNames.has(e.getText())
  })
  return escapes ? 'unknown' : false
}
