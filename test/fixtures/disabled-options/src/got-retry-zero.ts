import got from 'got'
export const f = () => got('https://api.vendor.dev/e', { retry: 0 })
