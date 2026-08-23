import { request } from 'node:http'
export const f = () => request({ host: 'x.dev' }, () => {})
