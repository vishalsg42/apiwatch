import http from 'node:http'
export const protectedGet = () =>
  http.get({ host: 'api.vendor.dev', path: '/a', timeout: 5000 }, () => {})
export const bareGet = () => http.get({ host: 'api.vendor.dev', path: '/b' }, () => {})
