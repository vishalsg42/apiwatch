// fetch(url, { method: 'POST' }): same regression as the axios bare-call case, for native
// fetch. AbortSignal.timeout isolates this from no-timeout so only no-retry is under test.
export const f = () =>
  fetch('https://x.dev/x', { method: 'POST', signal: AbortSignal.timeout(1000) })
