import { type Node, SyntaxKind } from 'ts-morph'
import type { UrlExpr } from '../model.js'

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return null
  }
}

export function classifyUrl(arg: Node | undefined): UrlExpr {
  if (!arg) return { kind: 'unknown' }
  const text = arg.getText()
  const kind = arg.getKind()
  // A no-substitution template is a string with different quotes. It has no dynamic part, so it
  // is read whole; the prefix-only path below exists for templates that DO interpolate, where
  // everything after the first `${` is unknowable. Reading them alike dropped the path of
  // `` `https://api.host.dev/v3/users` `` down to the origin.
  const literalText =
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    /^['"]/.test(text)
      ? text.slice(1, -1)
      : undefined
  if (literalText !== undefined) {
    const host = hostOf(literalText)
    if (host) return { kind: 'literal', url: literalText, host }
    // A path-only literal is still statically known, just origin-relative.
    if (literalText.startsWith('/')) return { kind: 'relative', url: literalText }
    return { kind: 'variable', expr: text }
  }
  if (text.startsWith('`')) {
    const m = /^`(https?:\/\/[^$`/]+)/.exec(text)
    const host = m ? hostOf(`${m[1]}/`) : null
    return host
      ? { kind: 'literal', url: m?.[1] as string, host }
      : { kind: 'variable', expr: text }
  }
  if (/\bconfig(Service)?\.get\(/.test(text)) return { kind: 'config', expr: text }
  if (text.startsWith('process.env')) return { kind: 'env', expr: text }
  return { kind: 'variable', expr: text }
}
