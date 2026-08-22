import got from 'got'

// Method-style usage: `got.get(url, options)` puts options at the same index as the bare-call
// `got(url, options)` shape; both must read the options object.
export const f = () => got.get('https://x.dev/x', { timeout: { request: 3000 } })
