import axios from 'axios'

// A comment mentioning "retry" inside the create() call must not be mistaken for a retry
// option — deriveFromCreate must only read the OWN top-level properties of the object literal.
const api = axios.create({
  // TODO: add retry handling here
  timeout: 5000,
})

export const f = () => api.get('https://x.dev/x')
