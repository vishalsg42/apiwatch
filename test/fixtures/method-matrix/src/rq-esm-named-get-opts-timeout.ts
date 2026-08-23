import { get } from 'request'
export const f = () => get({ uri: 'https://v.dev/a', timeout: 5000 }, () => {})
