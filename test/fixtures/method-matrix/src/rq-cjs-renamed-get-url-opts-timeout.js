const { get: fetchVendor } = require('request')
module.exports = () => fetchVendor('https://v.dev/a', { timeout: 5000 }, () => {})
