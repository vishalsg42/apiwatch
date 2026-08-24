import got from 'got'
// Shorthand: the value cannot be read, but the KEY is present, and got implements `retry`.
// Presence is what proves a retry policy exists; the value only matters for disablement.
const retry = { limit: 3 }
export const f = () => got('https://x.dev/a', { retry })
