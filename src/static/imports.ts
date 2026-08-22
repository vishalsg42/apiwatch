import {
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
    .filter((a): a is StringLiteral => !!a && a.getKind() === SyntaxKind.StringLiteral)
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
export function collectImportedNames(sf: SourceFile): Set<string> {
  const names = new Set<string>()
  for (const d of sf.getImportDeclarations())
    for (const n of d.getNamedImports()) names.add(n.getAliasNode()?.getText() ?? n.getName())
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = v.getInitializer()
    if (!init || !/^require\(['"][^'"]+['"]\)/.test(init.getText())) continue
    const nameNode = v.getNameNode()
    if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern)
      for (const el of (nameNode as ObjectBindingPattern).getElements()) names.add(el.getName())
  }
  return names
}
