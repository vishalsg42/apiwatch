// A lazy `require('axios')` inside a function body — not a top-level declaration — must still
// be detected as a client binding.
function fetchThing() {
  const axios = require('axios')
  return axios.get('https://x.dev/x')
}

module.exports = { fetchThing }
