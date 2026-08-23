import { request } from 'node:https'
export const f = () => request({ host: 'v.dev' }, () => {})
