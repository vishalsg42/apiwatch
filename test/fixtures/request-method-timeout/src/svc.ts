import request from 'request'

// Method-style usage of `request`, the README's own leading example, puts the options
// object SECOND, after the url, unlike the bare-call `request(options, cb)` shape.
export const f = (cb: (err: unknown, res: unknown) => void) =>
  request.get('https://x.dev/x', { timeout: 2000 }, cb)
