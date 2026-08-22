import axios from 'axios'

// `config` DOES set a timeout, but resolveOptions cannot see that: it only reads an
// ObjectLiteralExpression at the expected argument index, never traces an identifier back to
// its declaration. This mirrors twilio-node's src/base/RequestClient.ts:73.
const config = { url: 'https://x.dev/a', timeout: 5000, retry: 3 }

export const f = () => axios(config)
