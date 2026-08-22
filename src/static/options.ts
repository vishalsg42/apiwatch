import { type CallExpression, type Node, SyntaxKind } from 'ts-morph'
import type { CallOptions, ClientBinding } from '../model.js'
import { collectFileImports } from './callsites.js'

const RETRY_LIBS = ['axios-retry', 'p-retry', 'async-retry', 'retry-axios']
const objArgs = (c: CallExpression) =>
  c.getArguments().filter((a) => a.getKind() === SyntaxKind.ObjectLiteralExpression)

/**
 * Looks up an object literal's OWN top-level property by name, accepting both a regular
 * `PropertyAssignment` (`{ timeout: 5000 }`) and a `ShorthandPropertyAssignment`
 * (`{ timeout }`) — never a source-text regex, and never descending into nested literals.
 * A shorthand has no initializer node to inspect (the property name IS the binding), so it is
 * reported distinctly from a regular assignment: callers that care about a concrete literal
 * value (e.g. a numeric timeout) can tell "present but not statically known" apart from
 * "absent", while callers that only care about presence (retry/retries) can treat either kind
 * the same way.
 */
type PropLookup = { shorthand: true } | { shorthand: false; initializer: Node }
const prop = (n: Node, name: string): PropLookup | undefined => {
  const p = n.asKind(SyntaxKind.ObjectLiteralExpression)?.getProperty(name)
  if (!p) return undefined
  if (p.getKind() === SyntaxKind.ShorthandPropertyAssignment) return { shorthand: true }
  const init = p.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()
  return init ? { shorthand: false, initializer: init } : undefined
}

export function resolveOptions(
  call: CallExpression,
  binding: ClientBinding,
): Pick<CallOptions, 'timeoutMs' | 'retry'> {
  let timeoutMs: CallOptions['timeoutMs'] = null
  for (const o of objArgs(call)) {
    const t = prop(o, 'timeout')
    if (t) {
      if (!t.shorthand && t.initializer.getKind() === SyntaxKind.NumericLiteral) {
        const n = Number(t.initializer.getText())
        // axios (and others) document `timeout: 0` as "no timeout" — its own default — so a
        // literal 0 must NOT suppress no-timeout; leave timeoutMs unset and let the
        // instance-default fallback below still apply.
        timeoutMs = n === 0 ? null : n
      } else {
        // `{ timeout }` shorthand, or a non-literal value (variable/expression): a timeout IS
        // configured but its value isn't statically known here.
        timeoutMs = 'instance-default'
      }
      break
    }
    const sig = prop(o, 'signal')
    if (sig) {
      const m = !sig.shorthand
        ? /AbortSignal\.timeout\(\s*(\d+)\s*\)/.exec(sig.initializer.getText())
        : null
      timeoutMs = m ? Number(m[1]) : 'instance-default'
      break
    }
  }
  if (timeoutMs === null && binding.instanceTimeout) timeoutMs = 'instance-default'

  let retry: CallOptions['retry'] =
    binding.kind === 'got' || binding.instanceRetry ? 'library' : 'none'
  if (retry === 'none') {
    const imports = collectFileImports(call.getSourceFile())
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
