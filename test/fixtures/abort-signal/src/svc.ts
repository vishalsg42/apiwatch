export const f = () =>
  fetch('https://x.dev/a', { signal: AbortSignal.timeout(2000) })
