import got from 'got'
// got genuinely implements `retry`.
export const f = () => got('https://v.dev/a', { retry: { limit: 3 } })
