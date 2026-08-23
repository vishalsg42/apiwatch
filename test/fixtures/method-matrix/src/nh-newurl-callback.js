const http = require('node:http')
module.exports = (u) => http.request(new URL(u), () => {})
