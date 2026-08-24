import got from 'got'
export const f = () => got('https://v.dev/a', { retry: { limit: 0 } })
