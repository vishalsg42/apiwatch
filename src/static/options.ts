import { type CallExpression, type Node, SyntaxKind } from 'ts-morph'
import type { CallOptions, ClientBinding } from '../model.js'

const RETRY_LIBS = ['axios-retry', 'p-retry', 'async-retry', 'retry-axios']
const objArgs = (c: CallExpression) =>
  c.getArguments().filter((a) => a.getKind() === SyntaxKind.ObjectLiteralExpression)
const prop = (n: Node, name: string) =>
  n
    .asKind(SyntaxKind.ObjectLiteralExpression)
    ?.getProperty(name)
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()

export function resolveOptions(
  call: CallExpression,
  binding: ClientBinding,
): Pick<CallOptions, 'timeoutMs' | 'retry'> {
  let timeoutMs: CallOptions['timeoutMs'] = null
  for (const o of objArgs(call)) {
    const t = prop(o, 'timeout')
    if (t?.getKind() === SyntaxKind.NumericLiteral) {
      timeoutMs = Number(t.getText())
      break
    }
    const sig = prop(o, 'signal')
    if (sig) {
      const m = /AbortSignal\.timeout\(\s*(\d+)\s*\)/.exec(sig.getText())
      timeoutMs = m ? Number(m[1]) : 'instance-default'
      break
    }
  }
  if (timeoutMs === null && binding.instanceTimeout) timeoutMs = 'instance-default'

  let retry: CallOptions['retry'] =
    binding.kind === 'got' || binding.instanceRetry ? 'library' : 'none'
  if (retry === 'none') {
    const imports = call
      .getSourceFile()
      .getImportDeclarations()
      .map((d) => d.getModuleSpecifierValue())
    if (imports.some((i) => RETRY_LIBS.includes(i))) retry = 'library'
    else if (objArgs(call).some((o) => prop(o, 'retry') || prop(o, 'retries'))) retry = 'library'
    else if (
      call.getFirstAncestorByKind(SyntaxKind.ForStatement) ||
      call.getFirstAncestorByKind(SyntaxKind.WhileStatement)
    )
      retry = 'manual'
  }
  return { timeoutMs, retry }
}
