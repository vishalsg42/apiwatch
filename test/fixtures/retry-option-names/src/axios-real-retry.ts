import axios from 'axios'
// axios-retry's actual per-request key is the literal string 'axios-retry'.
export const f = () => axios.get('https://v.dev/a', { 'axios-retry': { retries: 3 } })
