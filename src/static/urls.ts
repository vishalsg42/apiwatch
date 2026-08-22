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
  if (arg.getKind() === SyntaxKind.StringLiteral || /^['"]/.test(text)) {
    const url = text.slice(1, -1)
    const host = hostOf(url)
    return host ? { kind: 'literal', url, host } : { kind: 'variable', expr: text }
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
