import { request } from 'node:http'
export const f = () => request({ host: 'v.dev', timeout: 5000 }, () => {})
