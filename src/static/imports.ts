import { type SourceFile, type StringLiteral, SyntaxKind } from 'ts-morph'

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
