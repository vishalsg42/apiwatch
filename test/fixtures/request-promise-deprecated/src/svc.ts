import rp from 'request-promise'

// request-promise never triggered deprecated-client despite being a thin wrapper around the
// already-deprecated `request` package; a first-class ClientKind the rule just forgot.
export const f = () => rp({ uri: 'https://x.dev/x', timeout: 1000 })
