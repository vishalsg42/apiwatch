const request = require('request')
module.exports = () => request.get('https://v.dev/a', () => {})
