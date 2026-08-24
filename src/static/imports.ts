import {
  type Node,
  type NoSubstitutionTemplateLiteral,
  type ObjectBindingPattern,
  type SourceFile,
  type StringLiteral,
  SyntaxKind,
} from 'ts-morph'

/** ESM import specifiers plus CommonJS `require(...)` specifiers, for pure/text-only rules. */
export function collectFileImports(sf: SourceFile): string[] {
  const esm = sf.getImportDeclarations().map((d) => d.getModuleSpecifierValue())
  const cjs = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(
      (c) =>
        c.getExpression().getKind() === SyntaxKind.Identifier &&
        c.getExpression().getText() === 'require',
    )
    .map((c) => c.getArguments()[0])
    // A backtick specifier is the same specifier. `require(`zod`)` is a
    // NoSubstitutionTemplateLiteral rather than a StringLiteral, so it was dropped here and the
    // file read as importing no validator, which made a validated response report as
    // unvalidated. The quoted spelling of identical code worked. A template WITH substitutions
    // is deliberately excluded: its specifier is not statically known.
    .filter(
      (a): a is StringLiteral | NoSubstitutionTemplateLiteral =>
        !!a &&
        (a.getKind() === SyntaxKind.StringLiteral ||
          a.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral),
    )
    .map((a) => a.getLiteralValue())
  return [...esm, ...cjs]
}

/**
 * The local binding names this file imports BY NAME: ESM named imports, plus their CommonJS
 * twin `const { x } = require(...)`. Deliberately excludes default and namespace imports (ESM
 * `import x from ...` / CJS `const x = require(...)`): those bindings are almost always the
 * client itself (`import axios from 'axios'`, `const request = require('request')`), and the
 * one caller of this helper uses it to detect a response escaping to a HELPER function pulled
 * in from elsewhere, which must not match the HTTP call's own callee.
 */
/**
 * The module specifier of `require('x')`, read from the AST rather than matched against source
 * text, or undefined when the initializer is not a static require.
 *
 * Two callers used the regex /^require\(['"]([^'"]+)['"]\)/ independently, and both inherited the
 * same blind spots: a backtick specifier and any whitespace, so `require(`./h`)` and
 * `require( "./h" )` matched nothing. The consequences were opposite and both wrong. In
 * collectImportedNames a response handed to an imported helper stopped abstaining and was called
 * proven-unvalidated; in the registry a cross-module client vanished and its whole consumer file
 * reported zero call sites, silently.
 *
 * One reader for both, so a third caller cannot reintroduce the same gap. A template WITH
 * substitutions is excluded on purpose: its specifier is not statically known.
 */
export function requireSpecifier(init: Node | undefined): string | undefined {
  const call = init?.asKind(SyntaxKind.CallExpression)
  if (!call) return undefined
  const callee = call.getExpression()
  if (callee.getKind() !== SyntaxKind.Identifier || callee.getText() !== 'require') return undefined
  const arg = call.getArguments()[0]
  const k = arg?.getKind()
  if (k !== SyntaxKind.StringLiteral && k !== SyntaxKind.NoSubstitutionTemplateLiteral)
    return undefined
  return arg.asKindOrThrow(k).getLiteralText()
}

export function collectImportedNames(sf: SourceFile): Set<string> {
  const names = new Set<string>()
  for (const d of sf.getImportDeclarations())
    for (const n of d.getNamedImports()) names.add(n.getAliasNode()?.getText() ?? n.getName())
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = v.getInitializer()
    if (requireSpecifier(init) === undefined) continue
    const nameNode = v.getNameNode()
    if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern)
      for (const el of (nameNode as ObjectBindingPattern).getElements()) names.add(el.getName())
  }
  return names
}
