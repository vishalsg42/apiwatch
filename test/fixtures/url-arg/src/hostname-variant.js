const http = require('node:http')
module.exports = () => {
  http.request({ hostname: 'alpha.vendor.dev', path: '/a' }, () => {})
  http.request({ hostname: 'beta.vendor.dev', path: '/b' }, () => {})
}
