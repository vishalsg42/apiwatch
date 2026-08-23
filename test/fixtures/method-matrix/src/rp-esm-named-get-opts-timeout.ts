import { get } from 'request-promise'
export const f = () => get({ uri: 'https://v.dev/a', timeout: 5000 })
