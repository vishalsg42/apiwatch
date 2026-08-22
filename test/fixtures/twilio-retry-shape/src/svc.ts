import axios from 'axios'

// Regression fixture mirroring twilio-node's src/base/RequestClient.ts:73: a bare
// `axios(config)` call, with `config` an identifier built elsewhere, sitting inside a
// jitter-backoff retry function. Neither no-timeout nor no-retry may fire here: the config
// object is unreadable, not proven to lack a timeout or a retry.
const DEFAULT_MAX_RETRIES = 3

function delay(retryCount: number) {
  return Math.random() * 2 ** retryCount * 100
}

export function requestWithRetry(config: unknown, retryCount = 0): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (retryCount > DEFAULT_MAX_RETRIES) {
      reject(new Error('max retries exceeded'))
      return
    }
    setTimeout(() => resolve(axios(config)), delay(retryCount))
  })
}
