import http from 'node:http'
import https from 'node:https'
declare const insecure: boolean

// stripe-node's actual shape. The client is chosen by an expression, so the callee's source text
// is `(insecure ? http : https)`, which matches no binding name.
export const viaTernary = () =>
  (insecure ? http : https).request({ host: 'v.dev', path: '/a' }, () => {})

// The control: identical call, client named directly. If this one ever stops being found, the
// fixture is broken rather than the limitation being fixed.
export const viaName = () => https.request({ host: 'v.dev', path: '/b' }, () => {})
