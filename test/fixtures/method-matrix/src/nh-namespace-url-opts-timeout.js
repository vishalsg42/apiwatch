const http = require('node:http')
module.exports = () => http.get('https://v.dev/a', { timeout: 5000 }, () => {})
