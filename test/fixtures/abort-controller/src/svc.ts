export const f = (c: AbortController) =>
  fetch('https://x.dev/a', { signal: c.signal })
