import axios from 'axios'

// A bare axios(config) call with a non-idempotent method in the config object. Before
// CallSite.method read from the config object, this call's method was unreadable (`undefined`)
// and IDEMPOTENT.has(undefined) === true meant it was wrongly treated as idempotent, firing a
// false no-retry.
export const f = () => axios({ method: 'post', url: 'https://x.dev/x', timeout: 1000 })
