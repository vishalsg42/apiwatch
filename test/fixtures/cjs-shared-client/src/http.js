const axios = require('axios')

// module.exports.x = ... is this CJS file's export surface, exactly like an exported `const x`.
module.exports.api = axios.create({ timeout: 5000 })
