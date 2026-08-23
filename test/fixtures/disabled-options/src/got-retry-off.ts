import got from 'got'
export const f = () => got('https://api.vendor.dev/d', { retry: { limit: 0 } })
