// Stub — Task 6 replaces this with real timeout/retry option resolution.
import type { CallExpression } from 'ts-morph'
import type { CallOptions, ClientBinding } from '../model.js'

export function resolveOptions(
  _call: CallExpression,
  _binding: ClientBinding,
): Pick<CallOptions, 'timeoutMs' | 'retry'> {
  return { timeoutMs: null, retry: 'none' }
}
