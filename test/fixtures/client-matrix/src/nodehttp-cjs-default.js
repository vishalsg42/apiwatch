const http = require('node:http')
module.exports = () => http.request({ host: 'x.dev' }, () => {})
