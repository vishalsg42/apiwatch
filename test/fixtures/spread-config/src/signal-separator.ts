export const f = () => fetch('https://v.dev/a', { signal: AbortSignal.timeout(10_000) })
